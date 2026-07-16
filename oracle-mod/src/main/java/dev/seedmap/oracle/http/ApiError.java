package dev.seedmap.oracle.http;

/**
 * Contract error: rendered as a non-2xx response with body
 * {@code {"error": {"code": "<snake_case>", "message": "<human>"}}}.
 */
public final class ApiError extends RuntimeException {
    @java.io.Serial
    private static final long serialVersionUID = 1L;

    private final String code;
    private final int status;

    private ApiError(String code, int status, String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String code() {
        return code;
    }

    public int status() {
        return status;
    }

    public static ApiError badParam(String message) {
        return new ApiError("bad_param", 400, message);
    }

    public static ApiError unknownDimension(String dim) {
        return new ApiError("unknown_dimension", 404, "unknown dimension: " + dim);
    }

    public static ApiError unknownStructure(String id) {
        return new ApiError("unknown_structure", 404, "unknown structure: " + id);
    }

    public static ApiError unknownStructureSet(String id) {
        return new ApiError("unknown_structure_set", 404, "unknown structure set: " + id);
    }

    public static ApiError notFound(String message) {
        return new ApiError("not_found", 404, message);
    }

    public static ApiError tooLarge(String message) {
        return new ApiError("too_large", 413, message);
    }

    public static ApiError internal(String message) {
        return new ApiError("internal", 500, message);
    }
}
