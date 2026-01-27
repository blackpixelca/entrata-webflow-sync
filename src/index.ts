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
      await syncSingleProperty(env, property);
    }

    console.log('✅ All properties synced successfully');
  } catch (error) {
    console.error('❌ Failed to sync properties:', error);
    throw error;
  }
}

async function syncSingleProperty(
  env: Env,
  config: PropertyConfig
): Promise<void> {
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
    await syncToWebflow(env, config, webflowItems);
    console.log(`  ✅ Successfully synced ${webflowItems.length} unit types to Webflow`);
  } catch (error) {
    console.error(`  ❌ Failed to sync property ${propertyName}:`, error);
    throw error;
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
  
  // Return the name itself if no keyword matches
  return name;
}

/**
 * Transform Entrata unit types to Webflow CMS items
 */
function transformToWebflowItems(
  unitTypes: EntrataUnitType[],
  config: PropertyConfig
): WebflowItem[] {
  return unitTypes.map((unitType) => {
    // Extract fields from the actual API structure
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
    
    // Generate slug
    const cleanLayoutName = layoutType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const slug = `${bedrooms}bed-${cleanLayoutName}`;
    
    // Calculate price per bedroom
    const pricePerBed = minRent && bedrooms ? Math.round(minRent / bedrooms) : 0;
    
    // Determine availability status
    const availabilityStatus = availableUnits > 0 ? 'available' : 'sold-out';
    
    // Determine tier based on name or price
    const isElite = tierFromName === 'Elite' || (tierFromName === '' && pricePerBed >= 900);
    const isSignature = tierFromName === 'Signature' || (tierFromName === 'Standard' || (tierFromName === '' && pricePerBed < 900 && pricePerBed > 0));
    
    return {
      fieldData: {
        // Basic info - matches Webflow collection
        'unit-name': name,
        'slug': slug,
        
        // Custom fields - matches Webflow collection
        'bedrooms': bedrooms,
        'bathrooms': bathrooms,
        'square-footage': sqft,
        'starting-price': minRent,
        'available-units': availableUnits,
        'layout-type': layoutType,
        'description': `${bedrooms} bedroom, ${bathrooms} bathroom ${layoutType} layout with ${sqft} sq ft. ${tierFromName ? `${tierFromName} tier.` : ''}`,
        'floor-plan-image': '', // No image in this API response
        'floorplan-id': unitTypeId.toString(),
        'availability-status': availabilityStatus,
        'tier-signature': isSignature,
        'tier-elite': isElite,
        'price-per-bed': pricePerBed,
        'property-id': config.entrataPropertyId,
        
        // Metadata
        '_archived': false,
        '_draft': false,
      },
    };
  });
}

/**
 * Sync items to Webflow CMS
 */
async function syncToWebflow(
  env: Env,
  config: PropertyConfig,
  items: WebflowItem[]
): Promise<void> {
  if (items.length === 0) {
    console.log('  ⚠️  No items to sync');
    return;
  }

  const endpoint = `https://api.webflow.com/v2/collections/${config.webflowCollectionId}/items`;
  const batchSize = 100;
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    console.log(`    Syncing batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)...`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        items: batch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Webflow API failed: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log(`    ✓ Batch synced: ${result.items?.length || 0} items`);

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
