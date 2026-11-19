export const PRODUCT_NAME = "Hibernate Tabs, Windows, and Sessions";
export const PRODUCT_SHORT_NAME = "HTWS";

export function isSupportedProductName(value: unknown): boolean {
  return value === PRODUCT_NAME;
}
