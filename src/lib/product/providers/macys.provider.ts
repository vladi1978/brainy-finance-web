import { createBasicRetailProvider } from "./retailProviderFactory";

export const macysProvider = createBasicRetailProvider({
  id: "macys",
  hostPattern: /macys\.com/i,
});
