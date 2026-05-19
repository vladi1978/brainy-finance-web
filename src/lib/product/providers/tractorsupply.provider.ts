import { createBasicRetailProvider } from "./retailProviderFactory";

export const tractorsupplyProvider = createBasicRetailProvider({
  id: "tractorsupply",
  hostPattern: /tractorsupply\.com/i,
});
