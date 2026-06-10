"use strict";

const catalyst = require("zcatalyst-sdk-node");
module.exports = async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);

    const datastore = catalystApp.datastore();

    const usageTable = datastore.table("WidgetUsageLogs");

    let rawBody = "";

    for await (const chunk of req) {
      rawBody += chunk.toString();
    }

    const body = JSON.parse(rawBody || "{}");
    let usageBreakdown = [];

    let totalBillingUnits = 0;

    let totalBillingCost = 0;

    let currentBillingBalance = null;

    const geocodeResponse = await fetch(
      `https://api.htagai.com/v1/address/geocode?address=${encodeURIComponent(
        body.address
      )}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const geocodeData = await geocodeResponse.json();

    // console.log(
    // 	"ALL HEADERS:",
    // 	Object.fromEntries(geocodeResponse.headers.entries())
    //   );

    // console.log(
    // 	"BILLING UNITS:",
    // 	geocodeResponse.headers.get("x-billing-units")
    // );

    // console.log(
    // 	"BILLING COST:",
    // 	geocodeResponse.headers.get("x-billing-cost")
    // );

    // console.log(
    // 	"BILLING BALANCE:",
    // 	geocodeResponse.headers.get("x-billing-balance")
    // );

    const billingUnits = Number(
      geocodeResponse.headers.get("x-billing-units") || 0
    );

    const billingCost = Number(
      geocodeResponse.headers.get("x-billing-cost") || 0
    );

    const billingBalance = geocodeResponse.headers.get("x-billing-balance");

    totalBillingUnits += billingUnits;

    totalBillingCost += billingCost;

    currentBillingBalance = billingBalance || currentBillingBalance;

    usageBreakdown.push(
      `address/geocode = ${billingUnits} units = ${billingCost} cost`
    );
    const environmentResponse = await fetch(
      `https://api.htagai.com/v1/address/environment?address_key=${body.address_key}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const environmentData = await environmentResponse.json();

    const environmentUnits = Number(
      environmentResponse.headers.get("x-billing-units") || 0
    );

    const environmentCost = Number(
      environmentResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += environmentUnits;

    totalBillingCost += environmentCost;

    usageBreakdown.push(
      `address/environment = ${environmentUnits} units = ${environmentCost} cost`
    );

    const estimatesResponse = await fetch(
      `https://api.htagai.com/v1/property/estimates?address_key=${body.address_key}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const estimatesUnits = Number(
      estimatesResponse.headers.get("x-billing-units") || 0
    );

    const estimatesCost = Number(
      estimatesResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += estimatesUnits;
    totalBillingCost += estimatesCost;

    usageBreakdown.push(
      `property/estimates = ${estimatesUnits} units = ${estimatesCost} cost`
    );

    const summaryResponse = await fetch(
      `https://api.htagai.com/v1/property/summary?address_key=${body.address_key}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const summaryUnits = Number(
      summaryResponse.headers.get("x-billing-units") || 0
    );

    const summaryCost = Number(
      summaryResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += summaryUnits;
    totalBillingCost += summaryCost;

    usageBreakdown.push(
      `property/summary = ${summaryUnits} units = ${summaryCost} cost`
    );

    const marketResponse = await fetch(
      `https://api.htagai.com/v1/property/market?address_key=${body.address_key}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const marketUnits = Number(
      marketResponse.headers.get("x-billing-units") || 0
    );

    const marketCost = Number(
      marketResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += marketUnits;
    totalBillingCost += marketCost;

    usageBreakdown.push(
      `property/market = ${marketUnits} units = ${marketCost} cost`
    );

    const demographicsResponse = await fetch(
      `https://api.htagai.com/v1/address/demographics?address_keys=${body.address_key}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const demographicsUnits = Number(
      demographicsResponse.headers.get("x-billing-units") || 0
    );

    const demographicsCost = Number(
      demographicsResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += demographicsUnits;
    totalBillingCost += demographicsCost;

    usageBreakdown.push(
      `address/demographics = ${demographicsUnits} units = ${demographicsCost} cost`
    );

    const marketSummaryResponse = await fetch(
      `https://api.htagai.com/v1/markets/summary?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const marketSummaryUnits = Number(
      marketSummaryResponse.headers.get("x-billing-units") || 0
    );

    const marketSummaryCost = Number(
      marketSummaryResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += marketSummaryUnits;
    totalBillingCost += marketSummaryCost;

    usageBreakdown.push(
      `markets/summary = ${marketSummaryUnits} units = ${marketSummaryCost} cost`
    );

    const growthResponse = await fetch(
      `https://api.htagai.com/v1/markets/growth/cumulative?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const growthUnits = Number(
      growthResponse.headers.get("x-billing-units") || 0
    );

    const growthCost = Number(
      growthResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += growthUnits;
    totalBillingCost += growthCost;

    usageBreakdown.push(
      `markets/growth/cumulative = ${growthUnits} units = ${growthCost} cost`
    );

    const supplyResponse = await fetch(
      `https://api.htagai.com/v1/markets/supply?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const supplyUnits = Number(
      supplyResponse.headers.get("x-billing-units") || 0
    );

    const supplyCost = Number(
      supplyResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += supplyUnits;
    totalBillingCost += supplyCost;

    usageBreakdown.push(
      `markets/supply = ${supplyUnits} units = ${supplyCost} cost`
    );

    const demandResponse = await fetch(
      `https://api.htagai.com/v1/markets/demand?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const demandUnits = Number(
      demandResponse.headers.get("x-billing-units") || 0
    );

    const demandCost = Number(
      demandResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += demandUnits;
    totalBillingCost += demandCost;

    usageBreakdown.push(
      `markets/demand = ${demandUnits} units = ${demandCost} cost`
    );

    const schoolsResponse = await fetch(
      `https://api.htagai.com/v1/address/schools?address_key=${body.address_key}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const schoolsUnits = Number(
      schoolsResponse.headers.get("x-billing-units") || 0
    );

    const schoolsCost = Number(
      schoolsResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += schoolsUnits;
    totalBillingCost += schoolsCost;

    usageBreakdown.push(
      `address/schools = ${schoolsUnits} units = ${schoolsCost} cost`
    );

    const fundamentalsResponse = await fetch(
      `https://api.htagai.com/v1/markets/fundamentals?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const fundamentalsUnits = Number(
      fundamentalsResponse.headers.get("x-billing-units") || 0
    );

    const fundamentalsCost = Number(
      fundamentalsResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += fundamentalsUnits;
    totalBillingCost += fundamentalsCost;

    usageBreakdown.push(
      `markets/fundamentals = ${fundamentalsUnits} units = ${fundamentalsCost} cost`
    );

    const scoresResponse = await fetch(
      `https://api.htagai.com/v1/markets/scores?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const scoresUnits = Number(
      scoresResponse.headers.get("x-billing-units") || 0
    );

    const scoresCost = Number(
      scoresResponse.headers.get("x-billing-cost") || 0
    );

    totalBillingUnits += scoresUnits;
    totalBillingCost += scoresCost;

    usageBreakdown.push(
      `markets/scores = ${scoresUnits} units = ${scoresCost} cost`
    );

    const cycleResponse = await fetch(
      `https://api.htagai.com/v1/markets/cycle?level=suburb&area_id=${body.suburb_pid}&property_type=${body.property_type}`,
      {
        method: "GET",
        headers: {
          "x-api-key": process.env.HTAG_API_KEY,
        },
      }
    );

    const cycleUnits = Number(
      cycleResponse.headers.get("x-billing-units") || 0
    );

    const cycleCost = Number(cycleResponse.headers.get("x-billing-cost") || 0);

    totalBillingUnits += cycleUnits;
    totalBillingCost += cycleCost;

    usageBreakdown.push(
      `markets/cycle = ${cycleUnits} units = ${cycleCost} cost`
    );

    // console.log("TOTAL BILLING UNITS:", totalBillingUnits);
    // console.log("TOTAL BILLING COST:", totalBillingCost);
    // console.log("USAGE BREAKDOWN:");
    // console.log(usageBreakdown.join("\n"));

    await usageTable.insertRow({
      Org_ID: body.org_id || "Unknown Org",
      CRM_User: body.crm_user || "Unknown User",
      Function_Name: body.function_name || "Unknown Function",
      Feature_Name: body.feature || "Unknown Feature",
      Record_ID: body.record_id || "Unknown Record",
      Execution_Time_MS: body.execution_time || 0,
      Status: body.status || "unknown",
      API_Consumption: totalBillingUnits,

      Usage_Response: usageBreakdown.join("\n"),
    });

    res.setHeader("Content-Type", "application/json");

    res.end(
      JSON.stringify({
        success: true,
      })
    );
  } catch (error) {
    console.error(error);

    res.setHeader("Content-Type", "application/json");

    res.end(
      JSON.stringify({
        success: false,
        error: error.toString(),
      })
    );
  }
};
