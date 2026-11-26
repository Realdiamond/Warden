// Re-export the shared contracts via a relative path so Node can run them directly (type
// stripping does not reach into node_modules, so we avoid the package-name import at runtime).
export * from "../../../packages/shared/src/index.ts";
