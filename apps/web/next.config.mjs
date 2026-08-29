/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than build output, so
  // Next compiles them alongside the app.
  transpilePackages: ["@videoai/contracts"],
  // Nothing here may hardcode a host: the API base is configuration, and the
  // deployment target is interchangeable (spec section 58).
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_NAME: process.env.APP_NAME,
  },
  webpack(config) {
    // Our packages are ESM TypeScript, so their relative imports carry a .js
    // specifier that resolves to a .ts file. Node and vitest apply this
    // mapping already; webpack needs to be told.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default config;
