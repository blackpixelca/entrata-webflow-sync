/**
 * Entrata → Webflow CMS Sync Worker
 * Syncs FLOORPLAN data from Entrata API to Webflow CMS collections
 * Easily replicable for multiple properties
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
  entrataPropertyId: string;  // Variable 1: Entrata property ID
  webflowSiteId: string;      // Variable 2: Webflow site ID  
  webflowCollectionId: string; // Variable 3: Webflow collection ID
  name?: string;              // Optional: friendly name for logs
}

// ============================================================================
// UPDATED INTERFACE FOR FLOORPLANS (instead of individual units)
// ============================================================================
interface EntrataFloorplan {
  floorplanId: string;
  floorplanName: string;      // "Corner", "Flat", "Townhouse"
  bedrooms: number;           // 2, 3, 4
  bathrooms: number;
  sqft: number;
  minRent?: number;           // Starting price
  maxRent?: number;
  availableUnits?: number;    // Count of available units
  totalUnits?: number;
  imageUrl?: string;
  layoutType?: string;        // "Corner", "Flat", "Townhouse"
  tier?: string;              // "Signature" or "Elite" - if Entrata provides this
}

interface WebflowItem {
  fieldData: Record<string, any>;
}

export default {
  // Scheduled handler for cron triggers
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('🚀 Starting scheduled Entrata → Webflow sync...');
    ctx.waitUntil(syncAllProperties(env));
  },

  // HTTP handler for manual triggers
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Manual trigger endpoint
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

/**
 * Sync all configured properties
 */
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

/**
 * Sync a single property from Entrata to Webflow
 */
async function syncSingleProperty(
  env: Env,
  config: PropertyConfig
): Promise<void> {
  const propertyName = config.name || config.entrataPropertyId;
  console.log(`\n🏢 Syncing property: ${propertyName}`);

  try {
    // 1. Fetch floorplans from Entrata (CHANGED FROM UNITS)
    console.log(`  📥 Fetching floorplans from Entrata...`);
    const entrataFloorplans = await fetchEntrataFloorplans(env, config.entrataPropertyId);
    console.log(`  ✓ Retrieved ${entrataFloorplans.length} floorplans from Entrata`);

    // 2. Transform to Webflow format
    console.log(`  🔄 Transforming data...`);
    const webflowItems = transformToWebflowItems(entrataFloorplans, config);

    // 3. Sync to Webflow CMS
    console.log(`  📤 Syncing to Webflow CMS...`);
    await syncToWebflow(env, config, webflowItems);
    console.log(`  ✅ Successfully synced ${webflowItems.length} floorplans to Webflow`);
  } catch (error) {
    console.error(`  ❌ Failed to sync property ${propertyName}:`, error);
    throw error;
  }
}

/**
 * Fetch floorplans from Entrata API
 * NOTE: You may need to adjust the method name and response path based on your Entrata API version
 */
async function fetchEntrataFloorplans(
  env: Env,
  propertyId: string
): Promise<EntrataFloorplan[]> {
  // Entrata API endpoint for floorplans
  const endpoint = `${env.ENTRATA_BASE_URL}/${env.ENTRATA_ORG}/v1/floorplans`;
  
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
        // NOTE: This method name may need to be adjusted based on your Entrata API
        // Common options: 'getFloorPlans', 'getUnitTypes', 'getPropertyFloorPlans'
        name: 'getFloorPlans',
        params: {
          propertyIds: propertyId,
          includeAvailability: true,  // Get availability counts
          includePricing: true        // Get pricing info
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
  
  // Log the full response to help debug
  console.log('  🔍 Entrata API Response:', JSON.stringify(data, null, 2));
  
  // Extract floorplans from JSON-RPC response
  // NOTE: This path may need adjustment based on actual API response structure
  // Check the console logs to see the actual structure
  return data.response?.result?.FloorPlans || 
         data.response?.result?.PropertyFloorPlans || 
         data.response?.result || 
         [];
}

/**
 * Transform Entrata floorplans to Webflow CMS items
 */
function transformToWebflowItems(
  entrataFloorplans: EntrataFloorplan[],
  config: PropertyConfig
): WebflowItem[] {
  return entrataFloorplans.map((floorplan) => ({
    fieldData: {
      // Core fields - ADJUST THESE FIELD SLUGS TO MATCH YOUR WEBFLOW COLLECTION
      name: floorplan.floorplanName || `${floorplan.bedrooms} Bedroom`,
      slug: `${floorplan.bedrooms}bed-${(floorplan.floorplanName || floorplan.layoutType || 'standard').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      
      // Floorplan details
      'floorplan-id': floorplan.floorplanId,
      'floorplan-name': floorplan.floorplanName || '',
      'layout-type': floorplan.layoutType || floorplan.floorplanName || '',
      'bedrooms': floorplan.bedrooms || 0,
      'bathrooms': floorplan.bathrooms || 0,
      'square-feet': floorplan.sqft || 0,
      
      // Pricing
      'starting-price': floorplan.minRent || 0,
      'max-price': floorplan.maxRent || 0,
      'price-per-bed': floorplan.minRent && floorplan.bedrooms 
        ? Math.round(floorplan.minRent / floorplan.bedrooms) 
        : 0,
      
      // Availability
      'available-units': floorplan.availableUnits || 0,
      'total-units': floorplan.totalUnits || 0,
      'availability-status': (floorplan.availableUnits || 0) > 0 ? 'available' : 'sold-out',
      
      // Tier (adjust logic based on your needs)
      // This is a placeholder - you may need to determine tier based on amenities or price
      'tier-signature': true,  // TODO: Add logic to determine tier
      'tier-elite': false,     // TODO: Add logic to determine tier
      
      // Media
      'thumbnail-image': floorplan.imageUrl || '',
      
      // Property reference
      'property-id': config.entrataPropertyId,
      
      // Timestamp
      'last-synced': new Date().toISOString(),
    },
  }));
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

  // Webflow bulk endpoint supports up to 100 items per request
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

    // Rate limiting: wait between batches
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
