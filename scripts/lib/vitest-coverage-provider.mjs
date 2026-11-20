import { existsSync } from 'node:fs';
import coverageV8 from '@vitest/coverage-v8';

// The v8 provider with the untested-file crawl moved out of the shards and into
// the single `--merge-reports` pass. Stock v8 has every shard glob the whole
// coverage.include tree (6,859 files here), transform and parse each file its
// partition never loaded, and print the parse failures (4,292 of them, the
// package and shared sources Vite never transforms) — four times over, for
// four maps the merge job then simply adds together. A shard now keeps the
// cost that is really its own, remapping the modules it loaded, and the merge
// crawls the files no shard loaded exactly once, so the merged report is the
// same map the stock provider produced.
//
// Used through coverage.provider = 'custom'; the fork-side hooks are the stock
// ones re-exported. Node and worker both import this file, so it stays plain.
export default {
  ...coverageV8,
  async getProvider() {
    const provider = await coverageV8.getProvider();
    const initialize = provider.initialize.bind(provider);
    provider.initialize = (ctx) => {
      initialize(ctx);
      if (ctx.config.mergeReports) return;
      // A shard measures what it loaded; its blob carries that map and nothing
      // else, so it renders no report of its own either.
      provider.getUntestedFiles = async () => [];
      provider.generateReports = async () => {};
    };
    provider.mergeReports = async (coverageMaps) => {
      const coverageMap = provider.createCoverageMap();
      for (const coverage of coverageMaps) coverageMap.merge(coverage);
      if (provider.options.include != null) {
        coverageMap.merge(await provider.getCoverageMapForUncoveredFiles(coverageMap.files()));
      }
      coverageMap.filter((filename) => existsSync(filename)
        && (!provider.options.excludeAfterRemap || provider.isIncluded(filename)));
      await provider.generateReports(coverageMap, true);
    };
    return provider;
  },
};
