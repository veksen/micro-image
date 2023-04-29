module.exports = {
  root: true,
  // This tells ESLint to load the config from the package `eslint-config-micro-image`
  extends: ["micro-image"],
  settings: {
    next: {
      rootDir: ["apps/*/"],
    },
  },
};
