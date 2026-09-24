/* The live plans are JSON files imported by the Cowork build (Vite reads JSON natively). */
declare module "*.json" {
  const value: unknown;
  export default value;
}
