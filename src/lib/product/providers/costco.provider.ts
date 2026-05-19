import { createBasicRetailProvider } from "./retailProviderFactory";

export const costcoProvider = createBasicRetailProvider({
  id: "costco",
  hostPattern: /costco\.com/i,
});
