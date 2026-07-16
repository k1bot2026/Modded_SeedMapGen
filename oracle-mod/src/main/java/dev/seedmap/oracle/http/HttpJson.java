package dev.seedmap.oracle.http;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Request/response plumbing shared by every endpoint: CORS, query parsing, JSON bodies, error envelope. */
public final class HttpJson {
    /** Exchange attribute holding the response status, read by the request logger. */
    public static final String STATUS_ATTRIBUTE = "seedmap.status";
    private static final Gson GSON = new Gson();
    private static final int MAX_BODY_BYTES = 8 * 1024 * 1024;

    private HttpJson() {
    }

    public static void applyCors(Headers headers) {
        headers.set("Access-Control-Allow-Origin", "*");
    }

    public static Map<String, String> queryParams(HttpExchange exchange) {
        Map<String, String> params = new HashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        if (raw == null || raw.isEmpty()) {
            return params;
        }
        for (String pair : raw.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            if (eq < 0) {
                params.put(URLDecoder.decode(pair, StandardCharsets.UTF_8), "");
            } else {
                params.put(
                        URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                        URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
            }
        }
        return params;
    }

    public static String requireString(Map<String, String> params, String name) {
        String value = params.get(name);
        if (value == null || value.isEmpty()) {
            throw ApiError.badParam("missing required parameter: " + name);
        }
        return value;
    }

    public static int requireInt(Map<String, String> params, String name) {
        return parseInt(requireString(params, name), name);
    }

    public static int parseInt(String value, String name) {
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            throw ApiError.badParam("parameter " + name + " is not an integer: " + value);
        }
    }

    public static int requireInt(JsonObject body, String name) {
        JsonElement el = body.get(name);
        if (el == null || !el.isJsonPrimitive()) {
            throw ApiError.badParam("missing required field: " + name);
        }
        BigDecimal value;
        try {
            value = el.getAsBigDecimal();
        } catch (RuntimeException e) {
            throw ApiError.badParam("field " + name + " is not an integer");
        }
        try {
            // Rejects both non-integral values (64.9 must not truncate to 64) and values
            // outside the int range; the contract has no float-typed int field.
            return value.intValueExact();
        } catch (ArithmeticException e) {
            // Do not echo the value: toPlainString() can OOM on extreme exponents
            // (e.g. 1e2147483647) and huge literals would be reflected back verbatim.
            throw ApiError.badParam("field " + name + " must be an integer in int range");
        }
    }

    public static String requireString(JsonObject body, String name) {
        JsonElement el = body.get(name);
        if (el == null || !el.isJsonPrimitive()) {
            throw ApiError.badParam("missing required field: " + name);
        }
        return el.getAsString();
    }

    public static JsonObject readJsonBody(HttpExchange exchange) throws IOException {
        byte[] bytes = readBody(exchange.getRequestBody());
        try {
            JsonElement root = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8));
            if (!root.isJsonObject()) {
                throw ApiError.badParam("request body must be a JSON object");
            }
            return root.getAsJsonObject();
        } catch (com.google.gson.JsonSyntaxException e) {
            throw ApiError.badParam("request body is not valid JSON: " + e.getMessage());
        }
    }

    private static byte[] readBody(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() > MAX_BODY_BYTES) {
                throw ApiError.tooLarge("request body exceeds " + MAX_BODY_BYTES + " bytes");
            }
        }
        return out.toByteArray();
    }

    public static void sendJson(HttpExchange exchange, int status, JsonElement body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        applyCors(headers);
        headers.set("Content-Type", "application/json; charset=utf-8");
        exchange.setAttribute(STATUS_ATTRIBUTE, status);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    public static void sendPng(HttpExchange exchange, byte[] png) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        applyCors(headers);
        headers.set("Content-Type", "image/png");
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        exchange.setAttribute(STATUS_ATTRIBUTE, 200);
        exchange.sendResponseHeaders(200, png.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(png);
        }
    }

    public static void sendError(HttpExchange exchange, ApiError error) throws IOException {
        JsonObject inner = new JsonObject();
        inner.addProperty("code", error.code());
        inner.addProperty("message", error.getMessage());
        JsonObject envelope = new JsonObject();
        envelope.add("error", inner);
        sendJson(exchange, error.status(), envelope);
    }
}
