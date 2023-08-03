import dotenv from "dotenv";
import { Configuration, OpenAIApi } from "openai";
import { promises as fs } from "fs";
import { join } from "path";
import { encode } from "gpt-tokenizer";
import * as edgedb from "edgedb";
import e from "./dbschema/edgeql-js";

dotenv.config({ path: ".env.local" });

const openAIApiKey = process.env.OPENAI_API_KEY;

interface Section {
  id?: string;
  path: string;
  tokens: number;
  content: string;
  embedding: number[];
}

async function generateEmbeddings() {
  try {
    if (openAIApiKey)
      throw new Error("Missing environment variable OPENAI_API_KEY");

    const openAIConfig = new Configuration({
      apiKey: openAIApiKey,
    });

    const openai = new OpenAIApi(openAIConfig);

    const client = edgedb.createClient();

    const sectionPaths = await walk("docs");

    console.log(`Discovered ${sectionPaths.length} sections`);

    // Delete old data from the DB.
    await e.delete(e.Section).run(client);

    const sections = await prepareSectionsData(sectionPaths, openai);

    // Bulk-insert all data into EdgeDB database.
    const query = e.params({ sections: e.json }, ({ sections }) => {
      return e.for(e.json_array_unpack(sections), (section) => {
        return e.insert(e.Section, {
          path: e.cast(e.str, section.path),
          content: e.cast(e.str, section.content),
          tokens: e.cast(e.int16, section.tokens),
          embedding: e.cast(e.OpenAIEmbedding, section.embedding),
        });
      });
    });

    await query.run(client, { sections });
  } catch (err) {
    console.error("Error while trying to regenerate all embeddings.", err);
  }

  console.log("Embedding generation complete");
}

async function walk(dir: string): Promise<string[]> {
  const immediateFiles = await fs.readdir(dir);

  const recursiveFiles: string[][] = await Promise.all(
    immediateFiles.map(async (file: any) => {
      const path = join(dir, file);
      const stats = await fs.stat(path);
      if (stats.isDirectory()) return walk(path);
      else if (stats.isFile()) return [path];
      else return [];
    })
  );

  const flattenedFiles: string[] = recursiveFiles.reduce(
    (all, folderContents) => all.concat(folderContents),
    []
  );

  return flattenedFiles.sort((a, b) => a.localeCompare(b));
}

async function prepareSectionsData(
  sectionPaths: string[],
  openai: OpenAIApi
): Promise<Section[]> {
  const contents: string[] = [];
  const sections: Section[] = [];

  for (const path of sectionPaths) {
    const content = await fs.readFile(path, "utf8");
    // OpenAI recommends replacing newlines with spaces for best results (specific to embeddings)
    const contentTrimmed = content.replace(/\n/g, " ");
    contents.push(contentTrimmed);
    sections.push({
      path,
      content,
      tokens: 0,
      embedding: [],
    });
  }

  const embeddingResponse = await openai.createEmbedding({
    model: "text-embedding-ada-002",
    input: contents,
  });

  if (embeddingResponse.status !== 200) {
    throw new Error(embeddingResponse.statusText);
  }

  embeddingResponse.data.data.forEach((item, i) => {
    sections[i].embedding = item.embedding;
    sections[i].tokens = encode(contents[i]).length;
  });

  return sections;
}

(async function main() {
  await generateEmbeddings();
})();
