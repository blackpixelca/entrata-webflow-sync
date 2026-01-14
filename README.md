# Entrata → Webflow CMS Sync Worker

**Cloudflare Worker that syncs property data from Entrata API to Webflow CMS collections.**

Easily replicable for multiple properties. Perfect for property management companies managing multiple Webflow sites.

---

## 📊 Architecture

```
┌─────────────────┐      Scheduled      ┌──────────────────────┐
│                 │       (Daily)         │                      │
│  Cloudflare     │────────────────────►│   Sync Worker        │
│  Cron Trigger   │                       │   (This Repo)        │
└─────────────────┘                       └──────────────────────┘
                                                     │
                                                     │
                            ┌────────────────────────┴────────────────────────┐
                            │                                                 │
                            ▼                                                 ▼
                   ┌────────────────────┐                           ┌─────────────────────┐
                   │   Entrata API      │                           │   Webflow CMS API   │
                   │   (Property Data)  │                           │   (Collection)      │
                   └────────────────────┘                           └─────────────────────┘
```

**Key Variables per Property:**
- **Variable 1**: Entrata Property ID
- **Variable 2**: Webflow Site ID
- **Variable 3**: Webflow Collection ID

---

## 🚀 Features

✅ **Multi-Property Support** - Configure multiple properties in a single worker  
✅ **Automated Daily Sync** - Runs on schedule (cron trigger)  
✅ **Manual Trigger** - Trigger sync via HTTP POST  
✅ **Batch Processing** - Handles large datasets with batching  
✅ **Rate Limiting** - Built-in delays to respect API limits  
✅ **Detailed Logging** - Clear console logs for debugging  
✅ **Type-Safe** - Full TypeScript support  

---

## 🛠️ Setup Instructions

### Step 1: Clone Repository

```bash
git clone https://github.com/blackpixelca/entrata-webflow-sync.git
cd entrata-webflow-sync
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Properties

Edit `wrangler.jsonc` and update the `PROPERTIES` array:

```jsonc
"vars": {
  "PROPERTIES": "[{\"entrataPropertyId\":\"YOUR_ENTRATA_PROPERTY_ID\",\"webflowSiteId\":\"YOUR_WEBFLOW_SITE_ID\",\"webflowCollectionId\":\"YOUR_WEBFLOW_COLLECTION_ID\",\"name\":\"Property Name\"}]"
}
```

**For Multiple Properties:**
```jsonc
"PROPERTIES": "[{\"entrataPropertyId\":\"PROP1_ID\",\"webflowSiteId\":\"SITE1_ID\",\"webflowCollectionId\":\"COLL1_ID\",\"name\":\"Downtown Tower\"},{\"entrataPropertyId\":\"PROP2_ID\",\"webflowSiteId\":\"SITE2_ID\",\"webflowCollectionId\":\"COLL2_ID\",\"name\":\"Riverside Apartments\"}]"
```

### Step 4: Set Secrets

Login to Cloudflare:
```bash
wrangler login
```

Set your API credentials:
```bash
wrangler secret put ENTRATA_API_KEY
# Enter your Entrata API key when prompted

wrangler secret put ENTRATA_BASE_URL
# Enter: https://your-entrata-api-domain.com

wrangler secret put WEBFLOW_API_TOKEN
# Enter your Webflow API token
```

### Step 5: Deploy

```bash
npm run deploy
```

---

## 📝 Configuration

### Cron Schedule

Edit `wrangler.jsonc` to change sync frequency:

```jsonc
"triggers": {
  "crons": ["0 7 * * *"]  // Daily at 7 AM UTC (2 AM EST)
}
```

**Common Schedules:**
- `"0 */6 * * *"` - Every 6 hours
- `"0 2,14 * * *"` - 2 AM and 2 PM daily
- `"0 0 * * 1"` - Weekly on Mondays

[Cron Expression Helper](https://crontab.guru/)

### Field Mapping

Edit `src/index.ts` → `transformToWebflowItems()` function to customize field mappings:

```typescript
fieldData: {
  name: `Unit ${unit.unitNumber}`,
  'unit-number': unit.unitNumber,
  'bedrooms': unit.beds || 0,
  // Add more fields as needed
}
```

---

## 🧪 Testing

### Test Locally

```bash
npm run dev
```

### Manual Trigger

Trigger sync manually via HTTP:

```bash
curl -X POST https://entrata-webflow-sync.YOUR_SUBDOMAIN.workers.dev/sync
```

### View Logs

```bash
npm run tail
```

Or view in [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → Your Worker → Logs

---

## 🔄 Replicating for New Properties

1. **Add Configuration** to `wrangler.jsonc`:
   ```jsonc
   "PROPERTIES": "[...existing properties..., {\"entrataPropertyId\":\"NEW_PROP_ID\",\"webflowSiteId\":\"NEW_SITE_ID\",\"webflowCollectionId\":\"NEW_COLL_ID\",\"name\":\"New Property\"}]"
   ```

2. **Redeploy**:
   ```bash
   npm run deploy
   ```

That's it! The worker will now sync the new property on the next scheduled run.

---

## 📊 Monitoring

### Check Execution
- Cloudflare Dashboard → Workers & Pages → Your Worker → Metrics
- See request volume, errors, CPU time

### Debug Issues
1. Check logs: `npm run tail`
2. Verify env variables in Cloudflare Dashboard
3. Test API credentials with manual fetch
4. Check Webflow collection field slugs match code

---

## ⚠️ Troubleshooting

### "Entrata API failed: 401"
✅ **Solution**: Verify `ENTRATA_API_KEY` secret is set correctly

### "Webflow API failed: 404"
✅ **Solution**: Check `webflowCollectionId` in config matches your Webflow collection

### "No items synced"
✅ **Solution**: Check Entrata API response structure in `fetchEntrataUnits()`. Adjust parsing logic if needed.

### "Rate limit exceeded"
✅ **Solution**: Increase delay between batches in `syncToWebflow()` function

---

## 📚 API Documentation

- [Webflow Data API Docs](https://developers.webflow.com/data/docs)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

---

## 🛡️ Security

- **All API credentials stored as Cloudflare Secrets** (encrypted)
- **Never commit secrets to Git**
- **Worker runs on Cloudflare's secure edge network**

---

## 💰 Cost

**Cloudflare Workers Free Tier:**
- 100,000 requests/day
- Cron triggers don't count against request limits
- **Cost: $0/month** for typical usage

---

## 👥 Support

Created by **Black Pixel** for property management automation.

---

## 📝 License

MIT
