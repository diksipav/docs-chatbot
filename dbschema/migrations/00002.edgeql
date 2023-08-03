CREATE MIGRATION m1on2fsfgpz2jmxw5jkecirqr6zrpkhdt4cjfjqqxtdbyavl7a2s2a
    ONTO m1qkslordei2jqgx6ebwsthynq2t2puhkjvrjr3synjey6gxbfxuna
{
  ALTER TYPE default::Section {
      DROP PROPERTY checksum;
  };
};
