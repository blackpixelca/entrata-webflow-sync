/**
 * Entrata → Webflow CMS Sync Worker
 * Syncs FLOORPLAN data from Entrata API to Webflow CMS collections
 * Uses getUnitTypes method to fetch floorplan data
 */

export interface Env {
  // Secrets (set via: wrangler secret put SECRET_NAME)
  ENTRATA_API_KEY: string;
  ENTRATA_BASE_URL: string;
  ENTRATA_ORG: string;
  WEBFLOW_API_TOKEN: string;

  // JSON array of property configurations
  PROPERTIES: string;

  // Sync log CMS collection ID
  SYNC_LOG_COLLECTION_ID: string;
}

interface PropertyConfig {
  entrataPropertyId: string;
  webflowSiteId: string;
  webflowCollectionId: string;
  name?: string;
}

interface EntrataUnitType {
  // Common fields - adjust based on actual API response
  UnitTypeId?: string;
  unitTypeId?: string;
  Name?: string;
  name?: string;
  UnitTypeName?: string;
  unitTypeName?: string;
  Bedrooms?: number;
  bedrooms?: number;
  Beds?: number;
  beds?: number;
  Bathrooms?: number;
  bathrooms?: number;
  Baths?: number;
  baths?: number;
  SquareFeet?: number;
  squareFeet?: number;
  SQFT?: number;
  sqft?: number;
  MinRent?: number;
  minRent?: number;
  MaxRent?: number;
  maxRent?: number;
  AvailableUnits?: number;
  availableUnits?: number;
  TotalUnits?: number;
  totalUnits?: number;
  ImageUrl?: string;
  imageUrl?: string;
  Description?: string;
  description?: string;
}

interface WebflowItem {
  fieldData: Record<string, any>;
}

interface SyncResult {
  propertyName: string;
  status: 'Success' | 'Failed';
  itemsSynced: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsDeleted: number;
  details: string;
}

interface ParsedFloorplan {
  unitTypeId: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  minRent: number;
  maxRent: number;
  availableUnits: number;
  layoutType: string;
  tierFromName: string;
  isElite: boolean;
  isSignature: boolean;
  pricePerBed: number;
  propertyId: string;
}

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('🚀 Starting scheduled Entrata → Webflow sync...');
    ctx.waitUntil(syncAllProperties(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/sync' && request.method === 'POST') {
      try {
        await syncAllProperties(env);
        return new Response('✅ Sync completed successfully', { status: 200 });
      } catch (error) {
        console.error('❌ Sync failed:', error);
        return new Response(`Sync failed: ${error}`, { status: 500 });
      }
    }

    return new Response('Entrata-Webflow Sync Worker. POST to /sync to trigger manually.', {
      status: 200,
    });
  },
};

async function syncAllProperties(env: Env): Promise<void> {
  try {
    const properties: PropertyConfig[] = JSON.parse(env.PROPERTIES);
    console.log(`📋 Found ${properties.length} property configuration(s)`);

    for (const property of properties) {
      const result = await syncSingleProperty(env, property);
      await writeSyncLog(env, result);
    }

    // Clean up logs older than 90 days
    await cleanupOldSyncLogs(env, 90);

    console.log('✅ All properties synced successfully');
  } catch (error) {
    console.error('❌ Failed to sync properties:', error);
    throw error;
  }
}

async function syncSingleProperty(
  env: Env,
  config: PropertyConfig
): Promise<SyncResult> {
  const propertyName = config.name || config.entrataPropertyId;
  console.log(`\n🏢 Syncing property: ${propertyName}`);

  try {
    // 1. Fetch unit types (floorplans) from Entrata
    console.log(`  📥 Fetching unit types from Entrata...`);
    const unitTypes = await fetchEntrataUnitTypes(env, config.entrataPropertyId);
    console.log(`  ✓ Retrieved ${unitTypes.length} unit types from Entrata`);

    // 2. Transform to Webflow format
    console.log(`  🔄 Transforming data...`);
    const webflowItems = transformToWebflowItems(unitTypes, config);

    // 3. Sync to Webflow CMS
    console.log(`  📤 Syncing to Webflow CMS...`);
    const { created, updated, deleted } = await syncToWebflow(env, config, webflowItems);
    console.log(`  ✅ Successfully synced ${webflowItems.length} grouped floorplans to Webflow`);

    // 4. Publish Webflow site
    console.log(`  🚀 Publishing Webflow site...`);
    await publishWebflowSite(env, config.webflowSiteId);
    console.log(`  ✅ Webflow site published`);

    return {
      propertyName,
      status: 'Success',
      itemsSynced: webflowItems.length,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsDeleted: deleted,
      details: `Synced ${webflowItems.length} floorplans: ${created} created, ${updated} updated, ${deleted} deleted.`,
    };
  } catch (error) {
    console.error(`  ❌ Failed to sync property ${propertyName}:`, error);
    return {
      propertyName,
      status: 'Failed',
      itemsSynced: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsDeleted: 0,
      details: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Fetch unit types (floorplans) from Entrata API using getUnitTypes method
 */
async function fetchEntrataUnitTypes(
  env: Env,
  propertyId: string
): Promise<EntrataUnitType[]> {
  const endpoint = `${env.ENTRATA_BASE_URL}/${env.ENTRATA_ORG}/v1/propertyunits`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Api-Key': env.ENTRATA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth: {
        type: 'apikey'
      },
      requestId: '1',
      method: {
        name: 'getUnitTypes',
        params: {
          propertyId: propertyId
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Entrata API failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = await response.json();

  // Log the full response to understand structure
  console.log('  🔍 Entrata API Response:', JSON.stringify(data, null, 2));

  // Extract unit types from response - try different possible paths
  let unitTypes: any = null;

  // Try common paths
  const possiblePaths = [
    data.response?.result?.unitTypes?.unitType,  // Correct path for this API
    data.response?.result?.UnitTypes,
    data.response?.result?.unitTypes,
    data.response?.result?.PropertyUnitTypes,
    data.response?.result?.PhysicalProperty?.Property?.UnitType,
    data.response?.result?.Property?.UnitType,
    data.response?.result
  ];

  for (const path of possiblePaths) {
    if (path && Array.isArray(path)) {
      unitTypes = path;
      break;
    }
  }

  // If still not found, check if result is an object with unit type data
  if (!unitTypes && data.response?.result && typeof data.response.result === 'object') {
    // Try to find an array property in result
    const resultObj = data.response.result;
    for (const key of Object.keys(resultObj)) {
      if (Array.isArray(resultObj[key]) && resultObj[key].length > 0) {
        console.log(`  ℹ️  Found array at: response.result.${key}`);
        unitTypes = resultObj[key];
        break;
      }
    }
  }

  // If still not an array, wrap in array or return empty
  if (!Array.isArray(unitTypes)) {
    console.log('  ⚠️  Response is not an array. Full response structure:');
    console.log('  ', JSON.stringify(data.response?.result, null, 2).substring(0, 500));

    // If it's a single object, wrap it in an array
    if (unitTypes && typeof unitTypes === 'object') {
      console.log('  ℹ️  Wrapping single object in array');
      unitTypes = [unitTypes];
    } else {
      console.log('  ❌ Could not find unit types in response');
      return [];
    }
  }

  if (unitTypes.length > 0) {
    console.log('  ✓ Sample unit type:', JSON.stringify(unitTypes[0], null, 2));
  }

  return unitTypes;
}

/**
 * Helper function to safely get field value (handles different casing)
 */
function getField(obj: any, ...fieldNames: string[]): any {
  for (const fieldName of fieldNames) {
    if (obj[fieldName] !== undefined) {
      return obj[fieldName];
    }
  }
  return undefined;
}

/**
 * Determine layout type from unit type name
 */
function determineLayoutType(name: string): string {
  if (!name) return 'Standard';

  const lowerName = name.toLowerCase();

  if (lowerName.includes('corner')) return 'Corner';
  if (lowerName.includes('townhouse') || lowerName.includes('town house')) return 'Townhouse';
  if (lowerName.includes('flat')) return 'Flat';
  if (lowerName.includes('penthouse')) return 'Penthouse';
  if (lowerName.includes('loft')) return 'Loft';
  if (lowerName.includes('studio')) return 'Studio';

  // Default to Standard if no layout keyword is found
  return 'Standard';
}

/**
 * Transform Entrata unit types to Webflow CMS items.
 * Groups floorplans by layoutType + bedrooms + bathrooms into a single CMS entry.
 */
function transformToWebflowItems(
  unitTypes: EntrataUnitType[],
  config: PropertyConfig
): WebflowItem[] {
  // ── Phase 1: Parse each unit type into an intermediate representation ──
  const parsed: ParsedFloorplan[] = unitTypes.map((unitType) => {
    const unitTypeId = unitType.identificationType?.idValue || '';
    const name = unitType.name || unitType.lookUpCode || 'Unknown';
    const bedrooms = parseInt(unitType.unitBedRooms) || 0;
    const bathrooms = parseInt(unitType.unitBathrooms) || 0;
    const sqft = parseInt(unitType.minSquareFeet) || parseInt(unitType.maxSquareFeet) || 0;

    // Extract rent from the rent.termRent array
    let minRent = 0;
    if (unitType.minMarketRent) {
      minRent = parseFloat(unitType.minMarketRent.replace(/,/g, '')) || 0;
    } else if (unitType.rent?.termRent && Array.isArray(unitType.rent.termRent)) {
      const rents = unitType.rent.termRent
        .map((tr: any) => parseFloat(tr['@attributes']?.rent?.replace(/,/g, '') || '0'))
        .filter((r: number) => r > 0);
      minRent = rents.length > 0 ? Math.min(...rents) : 0;
    }

    const maxRent = unitType.maxMarketRent ? parseFloat(unitType.maxMarketRent.replace(/,/g, '')) || minRent : minRent;
    const totalUnits = parseInt(unitType.unitCount) || 0;

    // Check if sold out
    const isSoldOut = unitType.rent?.termRent?.some((tr: any) =>
      tr['@attributes']?.isSoldOut === true || tr['@attributes']?.isSoldOut === 'true'
    ) || false;

    const availableUnits = isSoldOut ? 0 : totalUnits;

    // Determine layout type and tier from name
    const layoutType = determineLayoutType(name);
    const tierFromName = name.toLowerCase().includes('elite') ? 'Elite' :
                        name.toLowerCase().includes('signature') ? 'Signature' :
                        name.toLowerCase().includes('standard') ? 'Standard' : '';

    // Calculate price per bedroom
    const pricePerBed = minRent && bedrooms ? Math.round(minRent / bedrooms) : 0;

    // Determine tier based on name or price
    const isElite = tierFromName === 'Elite' || (tierFromName === '' && pricePerBed >= 900);
    const isSignature = tierFromName === 'Signature' || (tierFromName === 'Standard' || (tierFromName === '' && pricePerBed < 900 && pricePerBed > 0));

    return {
      unitTypeId,
      name,
      bedrooms,
      bathrooms,
      sqft,
      minRent,
      maxRent,
      availableUnits,
      layoutType,
      tierFromName,
      isElite,
      isSignature,
      pricePerBed,
      propertyId: config.entrataPropertyId,
    };
  });

  // ── Phase 2: Group by layoutType-bedrooms-bathrooms ──
  const groups = new Map<string, ParsedFloorplan[]>();
  for (const fp of parsed) {
    const groupKey = `${fp.layoutType.toLowerCase()}-${fp.bedrooms}b-${fp.bathrooms}b`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(fp);
  }

  console.log(`  ℹ️  Grouped ${parsed.length} floorplans into ${groups.size} unique entries`);

  // ── Phase 3: Merge each group into a single WebflowItem ──
  const results: WebflowItem[] = [];

  for (const [slug, members] of groups) {
    // Floorplan IDs: comma-separated list of all grouped IDs
    const floorplanIds = members.map(m => m.unitTypeId).join(',');

    // Use the first member's values for layout type, bedrooms, bathrooms (same across group)
    const bedrooms = members[0].bedrooms;
    const bathrooms = members[0].bathrooms;
    const layoutType = members[0].layoutType;

    // Starting price logic:
    //   - If both tiers have prices, use the smaller amount
    //   - If only one tier has a price, use that (ignore $0/null from unavailable tier)
    //   - If neither tier has a price, set to 0
    const rentsWithValues = members.map(m => m.minRent).filter(r => r > 0);
    const startingPrice = rentsWithValues.length > 0 ? Math.min(...rentsWithValues) : 0;

    // Square footage: average across group
    const sqftValues = members.map(m => m.sqft).filter(s => s > 0);
    const avgSqft = sqftValues.length > 0
      ? Math.round(sqftValues.reduce((sum, s) => sum + s, 0) / sqftValues.length)
      : 0;

    // Square footage range for description
    const minSqft = sqftValues.length > 0 ? Math.min(...sqftValues) : 0;
    const maxSqft = sqftValues.length > 0 ? Math.max(...sqftValues) : 0;

    // Tier booleans: true if ANY member is that tier
    const tierSignature = members.some(m => m.isSignature);
    const tierElite = members.some(m => m.isElite);

    // Tier-specific pricing: lowest non-zero price for each tier, 0 if unavailable
    const signatureRents = members.filter(m => m.isSignature).map(m => m.minRent).filter(r => r > 0);
    const signaturePrice = signatureRents.length > 0 ? Math.min(...signatureRents) : 0;

    const eliteRents = members.filter(m => m.isElite).map(m => m.minRent).filter(r => r > 0);
    const elitePrice = eliteRents.length > 0 ? Math.min(...eliteRents) : 0;

    // Available units split by tier
    const availableSignatureUnits = members
      .filter(m => m.isSignature)
      .reduce((sum, m) => sum + m.availableUnits, 0);
    const availableEliteUnits = members
      .filter(m => m.isElite)
      .reduce((sum, m) => sum + m.availableUnits, 0);
    const totalAvailableUnits = availableSignatureUnits + availableEliteUnits;

    // Availability status: Available if ANY has units
    const availabilityStatus = totalAvailableUnits > 0 ? 'Available' : 'Sold-out';

    // Price per bed: use the starting price / bedrooms (0 if no valid price)
    const pricePerBed = startingPrice && bedrooms ? Math.round(startingPrice / bedrooms) : 0;

    // Description: "3 bedroom, 3 bathroom Flat layout from 1236 to 1238 sq ft. Available in Elite and Signature tier."
    const sqftText = minSqft === maxSqft
      ? `with ${minSqft} sq ft`
      : `from ${minSqft} to ${maxSqft} sq ft`;
    const tierList: string[] = [];
    if (tierElite) tierList.push('Elite');
    if (tierSignature) tierList.push('Signature');
    const tierText = tierList.length > 0
      ? `Available in ${tierList.join(' and ')} tier.`
      : '';
    const description = `${bedrooms} bedroom, ${bathrooms} bathroom ${layoutType} layout ${sqftText}. ${tierText}`;

    results.push({
      fieldData: {
        // Basic info
        'name': layoutType,
        'slug': slug,

        // Custom fields
        'bedrooms': bedrooms,
        'bathrooms': bathrooms,
        'square-footage': avgSqft,
        'starting-price': startingPrice,
        'available-units': totalAvailableUnits,
        'available-signature-units': availableSignatureUnits,
        'available-elite-units': availableEliteUnits,
        'layout-type': layoutType,
        'description': description,
        // Note: 'floor-plan-image' is intentionally omitted to preserve manually-added images
        'floorplan-id': floorplanIds,
        'availability-status': availabilityStatus,
        'tier-signature': tierSignature,
        'tier-elite': tierElite,
        'signature-price': signaturePrice,
        'elite-price': elitePrice,
        'price-per-bed': pricePerBed,
        'property-id': config.entrataPropertyId,

        // Metadata
        '_archived': false,
        '_draft': false,
      },
    });
  }

  return results;
}

/**
 * Fetch all existing items from Webflow with pagination
 */
async function fetchAllWebflowItems(
  env: Env,
  collectionId: string
): Promise<any[]> {
  const allItems: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const listEndpoint = `https://api.webflow.com/v2/collections/${collectionId}/items?limit=${limit}&offset=${offset}`;
    const response = await fetch(listEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
        'accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Webflow API failed to fetch existing items: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    const items = data.items || [];
    allItems.push(...items);

    // Check if there are more items to fetch
    if (items.length < limit) {
      break;
    }

    offset += limit;

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return allItems;
}

/**
 * Sync items to Webflow CMS
 */
async function syncToWebflow(
  env: Env,
  config: PropertyConfig,
  items: WebflowItem[]
): Promise<{ created: number; updated: number; deleted: number }> {
  if (items.length === 0) {
    console.log('  ⚠️  No items to sync');
    return { created: 0, updated: 0, deleted: 0 };
  }

  // 1. Fetch ALL existing items from Webflow (with pagination)
  console.log('  📥 Fetching existing items from Webflow...');
  const existingItems = await fetchAllWebflowItems(env, config.webflowCollectionId);

  // Create a map of existing items by slug (the unique identifier for grouped floorplans)
  const existingItemsMap = new Map<string, any>();
  for (const item of existingItems) {
    const slug = item.fieldData?.['slug'];
    if (slug) {
      existingItemsMap.set(slug, item);
    }
  }

  console.log(`  ℹ️  Found ${existingItems.length} existing items in Webflow`);

  // 2. Process each item: update existing or create new
  let createdCount = 0;
  let updatedCount = 0;

  for (const item of items) {
    const slug = item.fieldData['slug'];
    const existingItem = existingItemsMap.get(slug);

    if (existingItem) {
      // Update existing item
      const updateEndpoint = `https://api.webflow.com/v2/collections/${config.webflowCollectionId}/items/${existingItem.id}`;
      const updateResponse = await fetch(updateEndpoint, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({
          fieldData: item.fieldData,
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error(`  ❌ Failed to update item ${slug}:`, errorText);
      } else {
        updatedCount++;
      }
    } else {
      // Create new item
      const createEndpoint = `https://api.webflow.com/v2/collections/${config.webflowCollectionId}/items`;
      const createResponse = await fetch(createEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        body: JSON.stringify({
          fieldData: item.fieldData,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`  ❌ Failed to create item ${slug}:`, errorText);
      } else {
        createdCount++;
      }
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // 3. Delete items whose slug no longer exists in the incoming grouped data
  const incomingSlugs = new Set(items.map((item) => item.fieldData['slug']));
  const itemsToDelete: any[] = [];

  for (const [slug, existingItem] of existingItemsMap) {
    if (!incomingSlugs.has(slug)) {
      itemsToDelete.push(existingItem);
    }
  }

  let deletedCount = 0;
  for (const item of itemsToDelete) {
    const deleteEndpoint = `https://api.webflow.com/v2/collections/${config.webflowCollectionId}/items/${item.id}`;
    const deleteResponse = await fetch(deleteEndpoint, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
        'accept': 'application/json',
      },
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error(`  ❌ Failed to delete item ${item.fieldData?.['slug']}:`, errorText);
    } else {
      deletedCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`  ✅ Created ${createdCount} new items, updated ${updatedCount} existing items, deleted ${deletedCount} stale items`);

  return { created: createdCount, updated: updatedCount, deleted: deletedCount };
}

/**
 * Publish Webflow site to make CMS changes live
 */
async function publishWebflowSite(
  env: Env,
  siteId: string
): Promise<void> {
  const publishEndpoint = `https://api.webflow.com/v2/sites/${siteId}/publish`;

  const response = await fetch(publishEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
      'Content-Type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      publishToWebflowSubdomain: true,
      publishToCustomDomains: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Webflow publish failed: ${response.status} - ${errorText}`);
  }

  console.log('  ✅ Published Webflow site');
}

/**
 * Write a sync log entry to the Webflow Sync Logs CMS collection
 */
async function writeSyncLog(env: Env, result: SyncResult): Promise<void> {
  if (!env.SYNC_LOG_COLLECTION_ID) {
    console.log('  ⚠️  No SYNC_LOG_COLLECTION_ID configured, skipping log');
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const slug = `${dateStr}-${result.propertyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  try {
    const endpoint = `https://api.webflow.com/v2/collections/${env.SYNC_LOG_COLLECTION_ID}/items`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        fieldData: {
          'name': `${dateStr} ${result.propertyName}`,
          'slug': slug,
          'status': result.status,
          'items-synced': result.itemsSynced,
          'items-created': result.itemsCreated,
          'items-updated': result.itemsUpdated,
          'items-deleted': result.itemsDeleted,
          'details': result.details,
          'property-name': result.propertyName,
          '_archived': false,
          '_draft': false,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  ❌ Failed to write sync log: ${response.status} - ${errorText}`);
    } else {
      const created = await response.json();
      console.log(`  📝 Sync log written: ${result.status}`);

      // Publish the log item so it's visible in the CMS
      if (created.id) {
        await fetch(
          `https://api.webflow.com/v2/collections/${env.SYNC_LOG_COLLECTION_ID}/items/publish`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
              'Content-Type': 'application/json',
              'accept': 'application/json',
            },
            body: JSON.stringify({ itemIds: [created.id] }),
          }
        );
      }
    }
  } catch (error) {
    console.error('  ❌ Failed to write sync log:', error);
  }
}

/**
 * Delete sync log entries older than the specified number of days
 */
async function cleanupOldSyncLogs(env: Env, maxDays: number): Promise<void> {
  if (!env.SYNC_LOG_COLLECTION_ID) return;

  try {
    const allLogs = await fetchAllWebflowItems(env, env.SYNC_LOG_COLLECTION_ID);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);

    let deletedCount = 0;
    for (const log of allLogs) {
      const createdOn = new Date(log.createdOn || log.fieldData?.['created-on'] || 0);
      if (createdOn < cutoff) {
        const deleteEndpoint = `https://api.webflow.com/v2/collections/${env.SYNC_LOG_COLLECTION_ID}/items/${log.id}`;
        const response = await fetch(deleteEndpoint, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
            'accept': 'application/json',
          },
        });

        if (response.ok) {
          deletedCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (deletedCount > 0) {
      console.log(`  🗑️  Cleaned up ${deletedCount} sync log(s) older than ${maxDays} days`);
    }
  } catch (error) {
    console.error('  ❌ Failed to cleanup old sync logs:', error);
  }
}
