// Images imported from assets/ are bundled by Metro, which hands back an asset number.
declare module "*.png" {
  const asset: number;
  export default asset;
}
