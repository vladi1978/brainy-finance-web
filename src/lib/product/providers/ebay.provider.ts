import { createBasicRetailProvider } from "./retailProviderFactory";

export const ebayProvider = createBasicRetailProvider({
  id: "ebay",
  hostPattern: /ebay\.com/i,
});
