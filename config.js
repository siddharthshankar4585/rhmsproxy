const config = {
  challenge: false, // Set to true if you want to enable password protection.
  users: {
    // You can add multiple users by doing username: 'password'.
    interstellar: "password",
  },
  // Dedicated admin code for /admin route. Prefer setting ADMIN_CODE in env.
  adminCode: process.env.ADMIN_CODE || "8319137",
};

export default config;
