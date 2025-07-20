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
app.get("/jira/issues", async (req, res) => {
  try {
    const jql = `assignee = currentUser() AND (issuetype = Bug OR issuetype = Story) ORDER BY created DESC`;
    const response = await axios.get(`${JIRA_BASE_URL}/rest/api/3/search`, {
      headers: jiraAuthHeader,
      params: {
        jql,
        fields: "key,summary,issuetype,status,description",
        maxResults: 10,
      },
    });

    const issues = response.data.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      type: issue.fields.issuetype.name,
      status: issue.fields.status.name,
      description:
        issue.fields.description?.content?.[0]?.content?.[0]?.text ||
        "No description",
    }));

    res.json(issues);
  } catch (error) {
    console.error("Error fetching Jira issues:", error);
    res.status(500).json({ error: "Failed to fetch issues from Jira" });
  }
});

// Send issue context to Hugging Face and get solution
app.post("/query-ai", async (req, res) => {
  const prompt = req.body.prompt;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required." });
  }
  try {
    const aiResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: process.env.OR_MODEL_ID || "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: Number(process.env.OR_MAX_TOKENS) || 512,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Accept": "application/json",
        },
      }
    );

    console.log("=== RAW RESPONSE FROM OPENROUTER ===");
    console.log(JSON.stringify(aiResponse.data, null, 2));

    const output =
      aiResponse.data.choices?.[0]?.message?.content ||
      "No response from model.";
    res.json({ response: output });
  } catch (error) {
    console.error("=== OPENROUTER API ERROR ===");
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Failed to query AI model." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ MCP Server running on http://localhost:${PORT}`);
});
