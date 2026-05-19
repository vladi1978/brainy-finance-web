import { createBasicRetailProvider } from "./retailProviderFactory";

export const academyProvider = createBasicRetailProvider({
  id: "academy",
  hostPattern: /academy\.com/i,
});
