import { createBasicRetailProvider } from "./retailProviderFactory";

export const adidasProvider = createBasicRetailProvider({
  id: "adidas",
  hostPattern: /adidas\.com/i,
});
