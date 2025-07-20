// File: server.js

const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_ID =
  process.env.OR_MODEL_ID || "openrouter:deepseek/deepseek-r1:free";
const MAX_TOKENS = process.env.OR_MAX_TOKENS || 512;

const jiraAuthHeader = {
  Authorization: `Basic ${Buffer.from(
    `${JIRA_EMAIL}:${JIRA_API_TOKEN}`
  ).toString("base64")}`,
  Accept: "application/json",
};

// Get assigned Jira issues (bugs + stories)
// Updated: /jira/issues with filterable query params
app.get("/jira/issues", async (req, res) => {
  const { priority, createdAfter, createdBefore, status, type } = req.query;

  let jqlParts = ["assignee = currentUser()"];

  if (type) jqlParts.push(`issuetype = "${type}"`);
  else jqlParts.push(`(issuetype = Bug OR issuetype = Story)`);

  if (priority) jqlParts.push(`priority = "${priority}"`);
  if (status) jqlParts.push(`status = "${status}"`);
  if (createdAfter) jqlParts.push(`created >= "${createdAfter}"`);
  if (createdBefore) jqlParts.push(`created <= "${createdBefore}"`);

  const jql = jqlParts.join(" AND ") + " ORDER BY created DESC";

  try {
    const response = await axios.get(`${JIRA_BASE_URL}/rest/api/3/search`, {
      headers: jiraAuthHeader,
      params: {
        jql,
        fields: "key,summary,issuetype,status,priority,description,created",
        maxResults: 20,
      },
    });

    const issues = response.data.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      type: issue.fields.issuetype.name,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name || "Not set",
      created: issue.fields.created,
      description:
        issue.fields.description?.content?.[0]?.content?.[0]?.text ||
        "No description",
    }));

    res.json({ issues, jql });
  } catch (error) {
    console.error("Error fetching filtered Jira issues:", error);
    res.status(500).json({ error: "Failed to fetch filtered issues." });
  }
});

// Send issue context to Hugging Face and get solution
app.post("/query-ai", async (req, res) => {
  const { prompt, filters } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required." });
  }

  try {
    const queryParams = new URLSearchParams(filters || {}).toString();
    const issueResponse = await axios.get(
      `http://localhost:${PORT}/jira/issues?${queryParams}`
    );

    const issuesContext = issueResponse.data.issues
      .map(
        (issue) =>
          `- [${issue.key}] ${issue.summary} (${issue.status}, ${issue.priority})`
      )
      .join("\n");

    const fullPrompt = `${prompt}\n\nRelated Jira issues:\n${issuesContext}`;

    // Gemini expects input as parts array
    const aiResponse = await axios.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      {
        contents: [
          {
            parts: [{ text: fullPrompt }],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        params: {
          key: process.env.GEMINI_API_KEY,
        },
      }
    );

    const output =
      aiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response from Gemini.";
    res.json({ response: output });
  } catch (error) {
    console.error("Gemini API Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to query Gemini AI." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ MCP Server running on http://localhost:${PORT}`);
});
