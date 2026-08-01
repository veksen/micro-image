module.exports = {
  reactStrictMode: true,
  experimental: {
    // TypeScript 7 does not expose the compiler API Next.js links against, so
    // Next shells out to `tsc` instead. Drop this once Next supports the TS7 API.
    useTypeScriptCli: true,
  },
};
