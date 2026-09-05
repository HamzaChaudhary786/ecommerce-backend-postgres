const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Log error for debugging
  console.error(`[Error Handler] ${req.method} ${req.path} - ${statusCode}: ${message}`);
  if (err.stack) console.error(err.stack);

  // ── Prisma Error Handling ──────────────────────────────────────────────────
  if (err.name === "PrismaClientKnownRequestError" || err.name === "PrismaClientValidationError") {
    console.error("Prisma Error:", err.message);
    // P2002: Unique constraint failed
    if (err.code === "P2002") {
      statusCode = 409;
      const target = err.meta?.target || [];
      message = `Duplicate value for field: ${target.join(", ")}`;
    }
    // P2003: Foreign key constraint failed
    else if (err.code === "P2003") {
      statusCode = 400;
      message = "Cannot delete or update this record because it is referenced by other data.";
    }
    // P2025: Record to update/delete not found
    else if (err.code === "P2025") {
      statusCode = 404;
      message = err.meta?.cause || "Record not found.";
    }
  }

  // ── Mongoose Legacy Support (just in case) ──────────────────────────────────
  if (err.name === "ValidationError") {
    statusCode = 400;
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    message = errors.join(". ") || err.message;
  }
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid value for field "${err.path}".`;
  }

  // ── Prisma Error Handling ────────────────────────────────────────────────
  if (err.code && typeof err.code === "string" && err.code.startsWith("P")) {
    if (err.code === "P2002") {
      statusCode = 409;
      const target = err.meta?.target || [];
      message = `Duplicate value for field: ${target.join(", ")}. Please use a unique value.`;
    } else if (err.code === "P2025") {
      statusCode = 404;
      message = "Record not found.";
    } else {
      statusCode = 400;
      message = "A database error occurred.";
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};

export default errorHandler;
