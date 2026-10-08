declare module "virtual:assets" {
  const assets: Record<string, { type: string; bytes: string }>;
  export default assets;
}
