/**
 * Example Usage of SQL CRUD Helper Functions
 * 
 * This file demonstrates how to use all the CRUD operations
 */

import {
  initializeDatabase,
  create,
  createMany,
  findById,
  findOne,
  findMany,
  findAll,
  count,
  updateById,
  updateMany,
  increment,
  decrement,
  upsert,
  deleteById,
  deleteMany,
  softDeleteById,
  restoreById,
  closePool,
} from "./index";

async function runExamples() {
  try {
    console.log("=== Starting CRUD Examples ===\n");

    // Initialize the database
    console.log("1. Initializing database...");
    await initializeDatabase();
    console.log("✓ Database initialized\n");

    // CREATE operations
    console.log("2. CREATE operations");
    
    const newUser = await create("users", {
      username: "johndoe",
      email: "john@example.com",
    });
    console.log("Created user:", newUser);

    const newUsers = await createMany("users", [
      { username: "janedoe", email: "jane@example.com" },
      { username: "bobsmith", email: "bob@example.com" },
    ]);
    console.log("Created multiple users:", newUsers.length);

    const newProduct = await create("products", {
      name: "Laptop",
      description: "High-performance laptop",
      price: 999.99,
      stock_quantity: 50,
    });
    console.log("Created product:", newProduct);
    console.log();

    // READ operations
    console.log("3. READ operations");
    
    const userById = await findById("users", newUser.id);
    console.log("Found user by ID:", userById?.username);

    const userByEmail = await findOne("users", { email: "jane@example.com" });
    console.log("Found user by email:", userByEmail?.username);

    const allUsers = await findAll("users");
    console.log("All users count:", allUsers.length);

    const expensiveProducts = await findMany("products", {
      where: { stock_quantity: 50 },
      orderBy: "price DESC",
      limit: 10,
    });
    console.log("Found expensive products:", expensiveProducts.length);

    const userCount = await count("users");
    console.log("Total users:", userCount);
    console.log();

    // UPDATE operations
    console.log("4. UPDATE operations");
    
    const updatedUser = await updateById("users", newUser.id, {
      username: "johndoe_updated",
    });
    console.log("Updated user:", updatedUser?.username);

    const updatedProducts = await updateMany(
      "products",
      { name: "Laptop" },
      { price: 899.99 }
    );
    console.log("Updated products:", updatedProducts.length);

    const incrementedProduct = await increment(
      "products",
      newProduct.id,
      "stock_quantity",
      10
    );
    console.log("Incremented stock to:", incrementedProduct?.stock_quantity);

    const decrementedProduct = await decrement(
      "products",
      newProduct.id,
      "stock_quantity",
      5
    );
    console.log("Decremented stock to:", decrementedProduct?.stock_quantity);

    const upsertedUser = await upsert(
      "users",
      "email",
      { username: "johndoe_final", email: "john@example.com" }
    );
    console.log("Upserted user:", upsertedUser?.username);
    console.log();

    // DELETE operations
    console.log("5. DELETE operations");
    
    // First, let's create a user to delete
    const userToDelete = await create("users", {
      username: "tempuser",
      email: "temp@example.com",
    });
    
    const deletedUser = await deleteById("users", userToDelete.id);
    console.log("Deleted user:", deletedUser?.username);

    const deletedUsers = await deleteMany("users", { 
      username: "bobsmith" 
    });
    console.log("Deleted users:", deletedUsers.length);

    // Soft delete example (if you have a deleted_at column)
    // const softDeleted = await softDeleteById("users", someId);
    // const restored = await restoreById("users", someId);
    
    console.log();

    // Final count
    const finalUserCount = await count("users");
    console.log("Final user count:", finalUserCount);

    console.log("\n=== All examples completed successfully! ===");

  } catch (error) {
    console.error("Error running examples:", error);
  } finally {
    // Always close the pool when done
    await closePool();
  }
}

// Run examples if this file is executed directly
if (import.meta.main) {
  runExamples();
}

export { runExamples };