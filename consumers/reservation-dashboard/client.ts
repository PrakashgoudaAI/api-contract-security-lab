export type InventoryCard = {
  sku: string;
  remaining: number;
  canReserve: boolean;
};

/** Consumer boundary: this dashboard only needs SKU and available stock. */
export async function inventoryCard(
  baseUrl: string,
  token: string,
): Promise<InventoryCard> {
  const response = await fetch(new URL("/inventory", baseUrl), {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Inventory could not be loaded.");
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !("sku" in value) ||
    typeof value.sku !== "string" ||
    !("available" in value) ||
    !Number.isInteger(value.available) ||
    typeof value.available !== "number" ||
    value.available < 0
  )
    throw new Error("Inventory response is incompatible with the dashboard.");
  return {
    sku: value.sku,
    remaining: value.available,
    canReserve: value.available > 0,
  };
}
