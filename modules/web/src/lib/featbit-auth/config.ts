export const FEATBIT_API_URL = (
  process.env.NEXT_PUBLIC_FEATBIT_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export const FEATBIT_API_V1 = `${FEATBIT_API_URL}/api/v1`;
