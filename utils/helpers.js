/**
 * Catch async errors in routes
 */
export const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * Standard App Error class
 */
export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Standard success response helper
 */
export const sendSuccess = (res, statusCode, message, data = {}) => {
  res.status(statusCode).json({
    success: true,
    status: "success",
    message,
    ...data,
  });
};

/**
 * Simple pagination helper
 */
export const paginate = (query) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

/**
 * Generate a unique order number
 */
export const generateOrderNumber = () => {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `EB-${ts.slice(-8)}-${rand}`;
};

/**
 * Normalize status strings (lowercase, underscored)
 */
export const normalizeStatus = (status) => {
  if (!status) return "";
  return status.toString().toLowerCase().trim().replace(/[\s-]/g, "_");
};
/**
 * Get approximate coordinates for major Pakistani cities
 */
export const getCityCoordinates = (cityName) => {
  if (!cityName) return [31.5204, 74.3587]; // Default to Lahore

  const city = cityName.toString().toLowerCase().trim();
  const coords = {
    'lahore': [31.5204, 74.3587],
    'karachi': [24.8607, 67.0011],
    'islamabad': [33.6844, 73.0479],
    'rawalpindi': [33.5651, 73.0169],
    'faisalabad': [31.4504, 73.1350],
    'multan': [30.1575, 71.5249],
    'sahiwal': [30.6682, 73.1114],
    'gujranwala': [32.1877, 74.1945],
    'peshawar': [34.0151, 71.5249],
    'quetta': [30.1798, 66.9750],
    'hyderabad': [25.3960, 68.3578],
    'sialkot': [32.4945, 74.5229],
    'sargodha': [32.0836, 72.6711],
    'bahawalpur': [29.3544, 71.6911],
    'sukkur': [27.7244, 68.8228],
    'jhang': [31.2772, 72.3333],
    'sheikhupura': [31.7131, 73.9783],
    'mardan': [34.1989, 72.0403],
    'gujrat': [32.5742, 74.0754],
    'kasur': [31.1179, 74.4461],
    'rahim yar khan': [28.4110, 70.3036],
    'okara': [30.8016, 73.4485],
    'mirpur khas': [25.5269, 69.0159],
    'chiniot': [31.7200, 72.9789],
    'kamoke': [31.9745, 74.2245],
    'mandibahauddin': [32.5861, 73.4917],
    'bureauwala': [30.1583, 72.6844],
    'mianwali': [32.5853, 71.5374],
    'vehari': [30.0419, 72.3528],
    'nowshera': [34.0151, 71.9723],
    'khuzdar': [27.8119, 66.6111],
    'chakwal': [32.9333, 72.8500],
    'kohat': [33.5869, 71.4414]
  };

  return coords[city] || [31.5204, 74.3587]; // Default to Lahore if city not found
};
