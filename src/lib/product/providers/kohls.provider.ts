import { createBasicRetailProvider } from "./retailProviderFactory";

export const kohlsProvider = createBasicRetailProvider({
  id: "kohls",
  hostPattern: /kohls\.com/i,
});
