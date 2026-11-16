module.exports = {
  src: "./src",
  language: "typescript",
  schema: require.resolve("@hccnj/schema/schema.graphql"),
  excludes: ["**/node_modules/**", "**/__mocks__/**", "**/__generated__/**"],
};
