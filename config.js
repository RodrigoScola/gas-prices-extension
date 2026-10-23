// Feature flags. Set ENV to "development" to get the sample email button and the
// paste box in the sidebar; "production" reads the open Gmail email and nothing else.
export const ENV = "production";

export const FEATURES = {
  sampleEmail: ENV === "development",
  emailTextBox: ENV === "development",
};
