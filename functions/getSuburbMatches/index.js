"use strict";

const axios = require("axios");
const catalyst = require("zcatalyst-sdk-node");

module.exports = async (req, res) => {
  const catalystApp = catalyst.initialize(req);

  // DATA STORE TABLE

  const zcql = catalystApp.zcql();
  const datastore = catalystApp.datastore();
  const creditsTable = datastore.table("CreditsBalance");

  const htagConsumptionTable = datastore.table("HTAGConsumptionLogs");

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
    let requestIds = [];

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

    const orgId = String(req.headers["x-org-id"] || "").trim();

    let creditRow = null;
    let tenantRow = null;

    const creditResult = await zcql.executeZCQLQuery(
      `SELECT * FROM CreditsBalance WHERE OrgID='${orgId}'`
    );

    const apiTenantResult = await zcql.executeZCQLQuery(
      `SELECT * FROM apiTenants WHERE Org_ID='${orgId}'`
    );

    const paymentHistoryResult = await zcql.executeZCQLQuery(
      `SELECT * FROM PaymentHistory
       WHERE OrgID='${orgId}'
       ORDER BY LastTopupDate DESC`
    );
    
    let lastTopupDate = "";
    let lastTopup = 0;
    let totalCreditsPurchased = 0;
    let latestPayment = null;
    
    if (paymentHistoryResult && paymentHistoryResult.length > 0) {
      paymentHistoryResult.forEach((row) => {
        totalCreditsPurchased += Number(
          row.PaymentHistory.CreditToppedUp || 0
        );
    
        if (
          !latestPayment ||
          new Date(row.PaymentHistory.LastTopupDate) >
            new Date(latestPayment.LastTopupDate)
        ) {
          latestPayment = row.PaymentHistory;
        }
      });
    
      if (latestPayment) {
        lastTopupDate = latestPayment.LastTopupDate || "";
        lastTopup = Number(latestPayment.CreditToppedUp || 0);
      }
    }

    if (creditResult && creditResult.length > 0) {
      creditRow = creditResult[0].CreditsBalance;
    }

    if (apiTenantResult && apiTenantResult.length > 0) {
      tenantRow = apiTenantResult[0].apiTenants;
    }

    if (
      tenantRow &&
      latestPayment &&
      latestPayment.LastTopupDate
    ) {
      const tenantLastTopup = tenantRow.LastTopUpDate
        ? new Date(tenantRow.LastTopUpDate)
        : null;
    
      const paymentLastTopup = new Date(
        latestPayment.LastTopupDate
      );
    
      if (
        !tenantLastTopup ||
        paymentLastTopup > tenantLastTopup
      ) {
        const topupCredits = Number(
          latestPayment.CreditToppedUp || 0
        );
    
        const currentCredits = Number(
          tenantRow.CreditsLeft || 0
        );
    
        const newCredits = currentCredits + topupCredits;
    
        await zcql.executeZCQLQuery(`
          UPDATE apiTenants
          SET CreditsLeft=${newCredits},
              CreditStatus='Active',
              LastTopUpDate='${latestPayment.LastTopupDate}'
          WHERE ROWID='${tenantRow.ROWID}'
        `);
    
        const refreshedTenant = await zcql.executeZCQLQuery(
          `SELECT * FROM apiTenants WHERE ROWID='${tenantRow.ROWID}'`
        );
    
        tenantRow = refreshedTenant[0].apiTenants;
      }
    }

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

    if (!tenantRow) {
      return res.end(
        JSON.stringify({
          success: false,
          message: "Tenant not found",
        })
      );
    }

    let currentCredits = Number(tenantRow.CreditsLeft || 0);

if (
  creditRow &&
  Number(creditRow.CreditsRemaining || 0) === 0 &&
  currentCredits > 0
) {
  await creditsTable.updateRow({
    ROWID: creditRow.ROWID,
    CreditsRemaining: currentCredits,
    Total_Credits_Purchased: totalCreditsPurchased,
  });

  creditRow.CreditsRemaining = currentCredits;
}

const MIN_REQUIRED_CREDITS = 20;

if (currentCredits < MIN_REQUIRED_CREDITS) {
  try {
    await WidgetUsageLogsTable.insertRow({
      Org_ID: orgId,

      CRM_User: currentUser?.first_name || "Unknown User",

      Function_Name: "getsuburbmatches",

      Feature_Name: "Suburb Intelligence",

      Record_ID:
        req.headers["x-record-id"] || body.recordID || "Unknown Record",

      Execution_Time_MS: 0,

      Status: "insufficient_credits",

      API_Consumption: 0,

      Usage_Response:
        `Available Credits=${currentCredits}, Required Credits=${MIN_REQUIRED_CREDITS}`,
    });
  } catch (logError) {
    console.error("INSUFFICIENT CREDIT LOG ERROR", logError);
  }

  return res.end(
    JSON.stringify({
      success: false,

      message:
        `Minimum ${MIN_REQUIRED_CREDITS} credits required to run Suburb Match Engine.`,

      available_credits: currentCredits,

      required_credits: MIN_REQUIRED_CREDITS,
    })
  );
}

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

    if (localityResponse.headers["x-amzn-requestid"]) {
      requestIds.push(localityResponse.headers["x-amzn-requestid"]);
    }

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
        } else if (yieldFilter === "4to5") {
          passesYield = yieldPercent >= 4 && yieldPercent < 5;
        } else if (yieldFilter === "5to6") {
          passesYield = yieldPercent >= 5 && yieldPercent < 6;
        } else if (yieldFilter === "6to7") {
          passesYield = yieldPercent >= 6 && yieldPercent < 7;
        } else if (yieldFilter === "over7") {
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

            if (growthResponse.headers["x-amzn-requestid"]) {
              requestIds.push(growthResponse.headers["x-amzn-requestid"]);
            }

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
            if (supplyResponse.headers["x-amzn-requestid"]) {
              requestIds.push(supplyResponse.headers["x-amzn-requestid"]);
            }

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
          } else if (stockOnMarketFilter === "1to2") {
            passesSoM = stockOnMarket >= 1 && stockOnMarket < 2;
          } else if (stockOnMarketFilter === "2to3") {
            passesSoM = stockOnMarket >= 2 && stockOnMarket < 3;
          } else if (stockOnMarketFilter === "3to5") {
            passesSoM = stockOnMarket >= 3 && stockOnMarket < 5;
          } else if (stockOnMarketFilter === "over5") {
            passesSoM = stockOnMarket >= 5;
          }

          /* INVENTORY FILTER */

          if (inventoryFilter === "under1") {
            passesInventory = inventory < 1;
          } else if (inventoryFilter === "1to2") {
            passesInventory = inventory >= 1 && inventory < 2;
          } else if (inventoryFilter === "2to3") {
            passesInventory = inventory >= 2 && inventory < 3;
          } else if (inventoryFilter === "over3") {
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
    if (!creditRow) {

      const newCreditRow = await creditsTable.insertRow({
        OrgID: orgId,
    
        CreditsRemaining: currentCredits,
    
        Total_Credits_Purchased: totalCreditsPurchased,
    
        Last_Credits_Consumed: 0,
    
        LastCreditUsageDate: ""
      });
    
      creditRow = newCreditRow;
    }

    let newBalance = currentCredits - totalBillingUnits;

    if (newBalance < 0) {
      newBalance = 0;
    }

    await creditsTable.updateRow({
      ROWID: creditRow.ROWID,
      CreditsRemaining: newBalance,
      Last_Credits_Consumed: totalBillingUnits,
      LastCreditUsageDate: new Date().toISOString().split("T")[0],
    });

    let tenantCreditStatus = "Active";

if (newBalance <= 0) {
  tenantCreditStatus = "Exhausted";
}
else if (newBalance <= 20) {
  tenantCreditStatus = "Low Credits";
}

await zcql.executeZCQLQuery(`
  UPDATE apiTenants
  SET CreditsLeft=${newBalance},
      CreditStatus='${tenantCreditStatus}'
  WHERE ROWID='${tenantRow.ROWID}'
`);

    try {
      await htagConsumptionTable.insertRow({
        RequestId: requestIds.join(", "),
        ModuleName: "Acquisition",

        WidgetName: "Shortlist Suburb",

        OrgID: orgId,

        APIUnitsConsumed: totalBillingUnits,

        APICost: totalBillingCost,

        FunctionName: "getsuburbmatches",

        ExecutionDateTime: new Date()
          .toISOString()
          .slice(0, 19)
          .replace("T", " "),

        RecordID: req.headers["x-record-id"] || "",

        CreditCostBreakdown: usageBreakdown.join("\n"),
      });

      console.log("HTAG CONSUMPTION LOG INSERTED");
    } catch (htagError) {
      console.error("HTAG LOG ERROR:", htagError);
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        success: true,

        suburbs: matchedSuburbs,

        credit_data: {
          available_credits: newBalance,
          last_credits_consumed: totalBillingUnits,
          credit_status: tenantCreditStatus,
          last_topup: lastTopup,
          last_topup_date: lastTopupDate,
          total_credits_purchased: totalCreditsPurchased
        },
      })
    );
  } catch (error) {
    // SAFE FAILURE LOGGING

    try {
      const executionTime = Date.now() - startTime;

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
