"use strict";

const axios = require("axios");
const catalyst = require("zcatalyst-sdk-node");

module.exports = async (req, res) => {
  const catalystApp = catalyst.initialize(req);
  /* =====================================================
DATA STORE TABLE
===================================================== */

  const datastore = catalystApp.datastore();

  const WidgetUsageLogsTable = datastore.table("WidgetUsageLogs");

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  /* =====================================================
	PREFLIGHT
	===================================================== */

  if (req.method === "OPTIONS") {
    res.end();

    return;
  }

  /* =====================================================
AUTHENTICATION CHECK
===================================================== */

  const currentUser = await catalystApp.userManagement().getCurrentUser();

  console.log("AUTHENTICATED USER:", currentUser);

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
    /* =====================================================
BODY PARSE
===================================================== */
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
    /* =====================================================
INPUTS
===================================================== */

    const preferredState = body.preferredState || "";

    const maxBudget = Number(body.maxBudget || 0);

    const minYield = Number(body.minYield || 0);

    const propertyCategory = body.propertyCategory || "";

    /* =====================================================
VALIDATION
===================================================== */

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

    /* =====================================================
PROPERTY TYPE
===================================================== */

    let propertyType = "house";

    if (propertyCategory && propertyCategory.toLowerCase().includes("unit")) {
      propertyType = "unit";
    }

    /* =====================================================
YIELD NORMALIZATION
===================================================== */

    let normalizedYield = minYield;

    if (normalizedYield > 1) {
      normalizedYield = normalizedYield / 100;
    }

    /* =====================================================
ENV VARIABLE
===================================================== */

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

    /* =====================================================
LOCALITY API
===================================================== */

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

    const localityResults = localityResponse.data.results || [];

    /* =====================================================
EMPTY RESULT SAFETY
===================================================== */

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

    /* =====================================================
MATCH COLLECTION
===================================================== */

    let matchedSuburbs = [];

    /* =====================================================
LOOP LOCALITIES
===================================================== */

    for (const locality of localityResults) {
      try {
        const suburbName = locality.locality || "";

        const locPid = locality.loc_pid || "";

        if (!locPid) {
          continue;
        }

        /* =====================================================
SUMMARY API
===================================================== */

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

        const summaryResults = summaryResponse.data.results || [];

        if (summaryResults.length === 0) {
          continue;
        }

        const summary = summaryResults[0];

        const typicalPrice = summary.typical_price || 0;

        const grossYield = summary.gross_yield || 0;

        /* =====================================================
PRIMARY FILTER
===================================================== */

        if (typicalPrice <= maxBudget && grossYield >= normalizedYield) {
          let price5YGrowth = 0;
          let inventory = 999;

          /* =====================================================
GROWTH API
===================================================== */

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

            const growthResults = growthResponse.data.results || [];

            if (growthResults.length > 0) {
              price5YGrowth = growthResults[0].price_5y_growth || 0;
            }
          } catch (growthError) {
            console.error("Growth API Error", growthError.message);
          }

          /* =====================================================
SUPPLY API
===================================================== */

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

            const supplyResults = supplyResponse.data.results || [];

            if (supplyResults.length > 0) {
              inventory = supplyResults[0].inventory || 999;
            }
          } catch (supplyError) {
            console.error("Supply API Error", supplyError.message);
          }

          /* =====================================================
MATCH SCORE
===================================================== */

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

          /* =====================================================
STORE MATCH
===================================================== */

          matchedSuburbs.push({
            suburb: suburbName,

            localityId: locPid,

            state: preferredState,

            medianPrice: Math.round(typicalPrice),

            rentalYield: (grossYield * 100).toFixed(2),

            fiveYearGrowth: (price5YGrowth * 100).toFixed(2),

            inventory: inventory,

            matchScore: matchScore.toFixed(2),
          });
        }
      } catch (suburbError) {
        console.error("Suburb Processing Error", suburbError.message);
      }
    }

    /* =====================================================
SORT RESULTS
===================================================== */

    matchedSuburbs.sort((a, b) => Number(b.matchScore) - Number(a.matchScore));

    /* =====================================================
SUCCESS RESPONSE
===================================================== */

    /* =====================================================
SAFE ANALYTICS LOGGING
===================================================== */

    try {
      const executionTime = Date.now() - startTime;

      await WidgetUsageLogsTable.insertRow({
        Org_ID: req.headers["x-org-id"] || "",

        CRM_User: currentUser?.first_name || "Unknown User",

        Function_Name: "getsuburbmatches",

        Feature_Name: "Suburb Intelligence",

        Record_ID: body.recordID || "Unknown Record",

        Execution_Time_MS: executionTime,

        Status: "success",

        API_Consumption: 1,
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
    /* =====================================================
SAFE FAILURE LOGGING
===================================================== */

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

    /* =====================================================
402 CREDIT EXHAUSTION
===================================================== */

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

    /* =====================================================
GENERIC ERROR
===================================================== */

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
