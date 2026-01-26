/**
 * Entrata → Webflow CMS Sync Worker
 * Syncs property data from Entrata API to Webflow CMS collections
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

interface EntrataUnit {
  unitId: string;
  unitNumber: string;
  buildingName?: string;
  floorplan?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  rent?: number;
  availableDate?: string;
  status?: string;
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
    // 1. Fetch units from Entrata
    console.log(`  📥 Fetching units from Entrata...`);
    const entrataUnits = await fetchEntrataUnits(env, config.entrataPropertyId);
    console.log(`  ✓ Retrieved ${entrataUnits.length} units from Entrata`);

    // 2. Transform to Webflow format
    console.log(`  🔄 Transforming data...`);
    const webflowItems = transformToWebflowItems(entrataUnits, config);

    // 3. Sync to Webflow CMS
    console.log(`  📤 Syncing to Webflow CMS...`);
    await syncToWebflow(env, config, webflowItems);
    console.log(`  ✅ Successfully synced ${webflowItems.length} items to Webflow`);
  } catch (error) {
    console.error(`  ❌ Failed to sync property ${propertyName}:`, error);
    throw error;
  }
}

/**
 * Fetch floorplans from Entrata API
 */
async function fetchEntrataFloorplans(
  env: Env,
  propertyId: string
): Promise<EntrataFloorplan[]> {
  const endpoint = `${env.ENTRATA_BASE_URL}/${env.ENTRATA_ORG}/v1/floorplans`; // Update endpoint
  
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
        name: 'getFloorPlans', // Update method name
        params: {
          propertyIds: propertyId,
          includeAvailability: true, // Get availability counts
          includePricing: true // Get pricing info
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
  
  // Extract floorplans from response (adjust path based on actual API response)
  return data.response?.result?.FloorPlans || [];
}

/**
 * Transform Entrata units to Webflow CMS items
 */
function transformToWebflowItems(
  entrataUnits: EntrataUnit[],
  config: PropertyConfig
): WebflowItem[] {
  return entrataUnits.map((unit) => ({
    fieldData: {
      // Core fields - adjust field slugs to match your Webflow collection
      name: `Unit ${unit.unitNumber}`,
      slug: `unit-${unit.unitNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      
      // Unit details
      'unit-number': unit.unitNumber,
      'unit-id': unit.unitId,
      'building-name': unit.buildingName || '',
      'floorplan': unit.floorplan || '',
      'bedrooms': unit.beds || 0,
      'bathrooms': unit.baths || 0,
      'square-feet': unit.sqft || 0,
      'rent': unit.rent || 0,
      'available-date': unit.availableDate || '',
      'status': unit.status || 'available',
      
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

