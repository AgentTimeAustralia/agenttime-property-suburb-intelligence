"use strict";

const axios = require("axios");
const catalyst = require("zcatalyst-sdk-node");

module.exports = async (req, res) => {
  const catalystApp = catalyst.initialize(req);

  // DATA STORE TABLE

  const datastore = catalystApp.datastore();

  const WidgetUsageLogsTable = datastore.table("WidgetUsageLogs");

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // PREFLIGHT

  if (req.method === "OPTIONS") {
    res.end();

    return;
  }

  // AUTHENTICATION CHECK

  const currentUser = await catalystApp.userManagement().getCurrentUser();

  // console.log("AUTHENTICATED USER:", currentUser);

  if (!currentUser || !currentUser.user_id) {
    res.writeHead(401, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        success: false,
        message: "Unauthorized",
      })
    );

    return;
  }

  try {
    const startTime = Date.now();

    // billing
    let usageBreakdown = [];
    let totalBillingUnits = 0;
    let totalBillingCost = 0;
    let currentBillingBalance = null;

    // BODY PARSE

    const rawBody = await new Promise((resolve, reject) => {
      let data = "";

      req.on("data", (chunk) => {
        data += chunk;
      });

      req.on("end", () => {
        resolve(data);
      });

      req.on("error", (err) => {
        reject(err);
      });
    });

    let body = {};

    try {
      body = JSON.parse(rawBody || "{}");
    } catch (parseError) {
      console.error("BODY PARSE ERROR", parseError);

      body = {};
    }

    // INPUTS

    const preferredState = body.preferredState || "";

    const maxBudget = Number(body.maxBudget || 0);

    const yieldFilter = body.minYield || "";

    const propertyCategory = body.propertyCategory || "";

    const stockOnMarketFilter = body.stockOnMarketFilter || "";

const inventoryFilter = body.inventoryFilter || "";

    // VALIDATION

    if (!preferredState) {
      res.statusCode = 400;

      res.setHeader("Content-Type", "application/json");

      res.end(
        JSON.stringify({
          success: false,
          message: "Preferred State missing",
        })
      );

      return;
    }

    // PROPERTY TYPE

    let propertyType = "house";

    if (propertyCategory && propertyCategory.toLowerCase().includes("unit")) {
      propertyType = "unit";
    }

    // ENV VARIABLE

    const apiKey = process.env.HTAG_API_KEY;

    if (!apiKey) {
      res.statusCode = 500;

      res.setHeader("Content-Type", "application/json");

      res.end(
        JSON.stringify({
          success: false,
          message: "HTAG API key missing",
        })
      );

      return;
    }

    // LOCALITY API

    const localityResponse = await axios.get(
      "https://api.htagai.com/v1/reference/locality",
      {
        headers: {
          "x-api-key": apiKey,
        },
        params: {
          state_name: preferredState,
          limit: 10,
        },
      }
    );

    // billing

    totalBillingUnits += Number(
      localityResponse.headers["x-billing-units"] || 0
    );

    usageBreakdown.push(
      `reference/locality = ${localityResponse.headers["x-billing-units"] || 0}`
    );

    totalBillingCost += Number(localityResponse.headers["x-billing-cost"] || 0);

    usageBreakdown.push(
      `reference/locality = ${localityResponse.headers["x-billing-cost"] || 0}`
    );

    currentBillingBalance =
      localityResponse.headers["x-billing-balance"] || currentBillingBalance;

    const localityResults = localityResponse.data.results || [];

    // EMPTY RESULT SAFETY

    if (localityResults.length === 0) {
      res.statusCode = 200;

      res.setHeader("Content-Type", "application/json");

      res.end(
        JSON.stringify({
          success: true,
          suburbs: [],
        })
      );

      return;
    }

    // MATCH COLLECTION

    let matchedSuburbs = [];

    // LOOP LOCALITIES

    for (const locality of localityResults) {
      try {
        const suburbName = locality.locality || "";

        const locPid = locality.loc_pid || "";

        if (!locPid) {
          continue;
        }

        // SUMMARY API

        const summaryResponse = await axios.get(
          "https://api.htagai.com/v1/markets/summary",
          {
            headers: {
              "x-api-key": apiKey,
            },
            params: {
              level: "suburb",
              area_id: locPid,
              property_type: propertyType,
            },
          }
        );

        // billing
        totalBillingUnits += Number(
          summaryResponse.headers["x-billing-units"] || 0
        );
        usageBreakdown.push(
          `markets/summary = ${summaryResponse.headers["x-billing-units"] || 0}`
        );
        totalBillingCost += Number(
          summaryResponse.headers["x-billing-cost"] || 0
        );

        usageBreakdown.push(
          `markets/summary = ${summaryResponse.headers["x-billing-cost"] || 0}`
        );

        currentBillingBalance =
          summaryResponse.headers["x-billing-balance"] || currentBillingBalance;

        const summaryResults = summaryResponse.data.results || [];

        if (summaryResults.length === 0) {
          continue;
        }

        const summary = summaryResults[0];

        const typicalPrice = summary.typical_price || 0;

        const grossYield = summary.gross_yield || 0;

        // PRIMARY FILTER

        const yieldPercent = grossYield * 100;

let passesYield = true;

if (yieldFilter === "under4") {
  passesYield = yieldPercent < 4;
}
else if (yieldFilter === "4to5") {
  passesYield = yieldPercent >= 4 && yieldPercent < 5;
}
else if (yieldFilter === "5to6") {
  passesYield = yieldPercent >= 5 && yieldPercent < 6;
}
else if (yieldFilter === "6to7") {
  passesYield = yieldPercent >= 6 && yieldPercent < 7;
}
else if (yieldFilter === "over7") {
  passesYield = yieldPercent >= 7;
}

if (typicalPrice <= maxBudget && passesYield) {
          let price5YGrowth = 0;
          let inventory = 999;
          let stockOnMarket = 999;

          // GROWTH API

          try {
            const growthResponse = await axios.get(
              "https://api.htagai.com/v1/markets/growth/cumulative",
              {
                headers: {
                  "x-api-key": apiKey,
                },
                params: {
                  level: "suburb",
                  area_id: locPid,
                  property_type: propertyType,
                },
              }
            );

            // billing

            totalBillingUnits += Number(
              growthResponse.headers["x-billing-units"] || 0
            );

            usageBreakdown.push(
              `markets/growth/cumulative = ${
                growthResponse.headers["x-billing-units"] || 0
              }`
            );

            totalBillingCost += Number(
              growthResponse.headers["x-billing-cost"] || 0
            );

            usageBreakdown.push(
              `markets/growth/cumulative = ${
                growthResponse.headers["x-billing-cost"] || 0
              }`
            );

            currentBillingBalance =
              growthResponse.headers["x-billing-balance"] ||
              currentBillingBalance;

            const growthResults = growthResponse.data.results || [];

            if (growthResults.length > 0) {
              price5YGrowth = growthResults[0].price_5y_growth || 0;
            }
          } catch (growthError) {
            console.error("Growth API Error", growthError.message);
          }

          // SUPPLY API

          try {
            const supplyResponse = await axios.get(
              "https://api.htagai.com/v1/markets/supply",
              {
                headers: {
                  "x-api-key": apiKey,
                },
                params: {
                  level: "suburb",
                  area_id: locPid,
                  property_type: propertyType,
                },
              }
            );

            // billing

            totalBillingUnits += Number(
              supplyResponse.headers["x-billing-units"] || 0
            );

            usageBreakdown.push(
              `markets/supply = ${
                supplyResponse.headers["x-billing-units"] || 0
              }`
            );

            totalBillingCost += Number(
              supplyResponse.headers["x-billing-cost"] || 0
            );

            usageBreakdown.push(
              `markets/supply = ${
                supplyResponse.headers["x-billing-cost"] || 0
              }`
            );

            currentBillingBalance =
              supplyResponse.headers["x-billing-balance"] ||
              currentBillingBalance;

            const supplyResults = supplyResponse.data.results || [];

            if (supplyResults.length > 0) {
              inventory = supplyResults[0].inventory || 999;

              stockOnMarket = (supplyResults[0].som_percent || 0) * 100;
            }
          } catch (supplyError) {
            console.error("Supply API Error", supplyError.message);
          }

          let passesSoM = true;
let passesInventory = true;

/* STOCK ON MARKET FILTER */

if (stockOnMarketFilter === "under1") {
  passesSoM = stockOnMarket < 1;
}
else if (stockOnMarketFilter === "1to2") {
  passesSoM = stockOnMarket >= 1 && stockOnMarket < 2;
}
else if (stockOnMarketFilter === "2to3") {
  passesSoM = stockOnMarket >= 2 && stockOnMarket < 3;
}
else if (stockOnMarketFilter === "3to5") {
  passesSoM = stockOnMarket >= 3 && stockOnMarket < 5;
}
else if (stockOnMarketFilter === "over5") {
  passesSoM = stockOnMarket >= 5;
}

/* INVENTORY FILTER */

if (inventoryFilter === "under1") {
  passesInventory = inventory < 1;
}
else if (inventoryFilter === "1to2") {
  passesInventory = inventory >= 1 && inventory < 2;
}
else if (inventoryFilter === "2to3") {
  passesInventory = inventory >= 2 && inventory < 3;
}
else if (inventoryFilter === "over3") {
  passesInventory = inventory >= 3;
}

/* SKIP IF FILTER FAILS */

if (!passesSoM || !passesInventory) {
  continue;
}

          // MATCH SCORE

          let matchScore = 0;

          /* 5Y Growth Weight */
          matchScore += price5YGrowth * 100;

          /* Low Inventory Bonus */
          if (inventory < 2) {
            matchScore += 20;
          }

          /* Affordable Bonus */
          if (typicalPrice < maxBudget * 0.85) {
            matchScore += 10;
          }

          //STORE MATCH

          matchedSuburbs.push({
            suburb: suburbName,
        
            localityId: locPid,
        
            state: preferredState,
        
            medianPrice: Math.round(typicalPrice),
        
            rentalYield: (grossYield * 100).toFixed(2),
        
            fiveYearGrowth: (price5YGrowth * 100).toFixed(2),
        
            inventory: inventory,
        
            stockOnMarket: stockOnMarket.toFixed(2),
        
            matchScore: matchScore.toFixed(2),
        });
        }
      } catch (suburbError) {
        console.error("Suburb Processing Error", suburbError.message);
      }
    }

    // SORT RESULTS

    matchedSuburbs.sort((a, b) => Number(b.matchScore) - Number(a.matchScore));

    matchedSuburbs = matchedSuburbs.map((suburb, index) => ({
      rank: index + 1,
      ...suburb,
    }));

    //  SAFE ANALYTICS LOGGING

    try {
      const executionTime = Date.now() - startTime;

      // console.log("Localities Returned:", localityResults.length);

      // console.log("Matched Suburbs:", matchedSuburbs.length);

      // console.log("Total Billing Units:", totalBillingUnits);

      await WidgetUsageLogsTable.insertRow({
        Org_ID: req.headers["x-org-id"] || "",

        CRM_User: currentUser?.first_name || "Unknown User",

        Function_Name: "getsuburbmatches",

        Feature_Name: "Suburb Intelligence",

        Record_ID:
          req.headers["x-record-id"] || body.recordID || "Unknown Record",

        Execution_Time_MS: executionTime,

        Status: "success",

        // API_Consumption: 1,
        // billing
        API_Consumption: totalBillingUnits,

        Usage_Response: usageBreakdown.join("\n"),
      });
    } catch (loggingError) {
      console.error("LOGGING ERROR:", loggingError);
    }

    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        success: true,
        suburbs: matchedSuburbs,
      })
    );
  } catch (error) {
    // SAFE FAILURE LOGGING

    try {
      const executionTime = Date.now() - startTime;

      //billing

      // console.log("HTAG Units:", totalBillingUnits);

      // console.log("HTAG Cost:", totalBillingCost);

      // console.log("HTAG Balance:", currentBillingBalance);

      await WidgetUsageLogsTable.insertRow({
        Org_ID: req.headers["x-zc-projectid"] || "",

        CRM_User: currentUser?.first_name || "Unknown",

        Function_Name: "getsuburbmatches",

        Feature_Name: "Suburb Intelligence",

        Record_ID: body.recordID || "",

        Execution_Time_MS: executionTime,

        Status: "failed",

        API_Consumption: 1,
      });
    } catch (loggingError) {
      console.error("LOGGING ERROR:", loggingError);
    }
    console.error(error);

    // 402 CREDIT EXHAUSTION

    if (error.response && error.response.status === 402) {
      res.statusCode = 402;

      res.setHeader("Content-Type", "application/json");

      res.end(
        JSON.stringify({
          success: false,
          message: "HtAG credits exhausted",
        })
      );

      return;
    }

    // GENERIC ERROR

    res.statusCode = 500;

    res.setHeader("Content-Type", "application/json");

    res.end(
      JSON.stringify({
        success: false,
        message: "Internal Server Error",
      })
    );
  }
};
