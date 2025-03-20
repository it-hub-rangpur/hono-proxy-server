import { Hono } from "hono";
import { fetch } from "undici";
import { serve } from "@hono/node-server";

const app = new Hono();
const port = 5000;

async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const response = await fetch(url, options);
      if (response.status >= 200 && response.status < 300) {
        return response;
      }

      if (response.status === 302) {
        return response;
      }
    } catch (error) {
      console.log("error:", error);
      attempt++;
      if (attempt >= retries) {
        throw new Error(
          `Failed to fetch after ${retries} attempts: ${error.message}`
        );
      }
      const retryDelay = delay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  throw new Error("Failed to fetch after retrying");
}

app.all("*", async (c) => {
  const url = new URL(c?.req?.url);
  const targetURL = "https://payment.ivacbd.com" + url.pathname + url.search;
  console.log(`Request URL: ${targetURL}, Method: ${c.req.method}`);

  if (url.pathname === "/favicon.ico") {
    return new Response(null, {
      status: 204,
    });
  }

  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers) {
    if (
      key.toLowerCase() === "host" ||
      key.toLowerCase() === "origin" ||
      key.toLowerCase() === "referer" ||
      key.toLowerCase() === "user-agent"
    ) {
      continue;
    }
    headers.set(key, value);
  }

  headers.set("Host", "payment.ivacbd.com");
  headers.set("Referer", "https://payment.ivacbd.com");
  headers.set("Origin", "https://payment.ivacbd.com");

  if (c?.req?.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    const response = await fetchWithRetry(targetURL, {
      method: c.req.method,
      headers: headers,
      redirect: "manual",
      body:
        c.req.method === "GET" || c.req.method === "HEAD" ? null : c.req.body,
    });

    const modifiedHeaders = new Headers(response.headers);
    modifiedHeaders.set("Access-Control-Allow-Origin", "*");
    modifiedHeaders.set("Access-Control-Allow-Credentials", "true");
    modifiedHeaders.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE"
    );
    modifiedHeaders.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, X-CSRF-Token"
    );
    modifiedHeaders.set("Access-Control-Max-Age", "86400");

    if (url?.pathname === "/" && c?.req?.method === "GET") {
      const body = await response.text();
      return new Response(body, {
        status: 200,
        statusText: "OK",
        headers: {
          ...modifiedHeaders,
        },
      });
    } else if (response.status === 302) {
      const location = response.headers.get("Location");
      modifiedHeaders.set("Location", location);
      return new Response(null, {
        status: 302,
        statusText: "Found",
        headers: modifiedHeaders,
      });
    } else {
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...modifiedHeaders,
        },
      });
    }
  } catch (error) {
    console.error("Error:", error);
    throw new Error(error);
  }
});

serve({
  fetch: app.fetch,
  port,
});

console.log(`Listening on http://localhost:${port}`);
