# 🚀 Docker Database CLI Cheat Sheet (Mongo & Redis)

*Use these commands to interact with your databases directly in the terminal without opening heavy browser GUIs.*

---

## ⚡ 1. All-in-One Quick Snapshot
*Run this in your normal terminal to instantly print all MongoDB databases and Redis keys without entering the shells.*

<!-- Mongoose -->
docker exec -it nest_mongo mongosh -u admin -p password123 --authenticationDatabase 

show dbs                                // List all databases
use <database_name>                     // Switch to a specific database
show collections                        // List all collections (tables)
db.<collection>.find().limit(5)         // View first 5 documents
db.<collection>.findOne()               // View exactly 1 document
db.<collection>.countDocuments()        // Count total documents
exit                                    // Exit the shell


<!-- _____________________Redis___________________________ -->
docker exec -it nest_redis redis-cli
KEYS *                                  // List ALL keys currently in Redis
KEYS cache:*                            // List keys matching a specific pattern
GET <key_name>                          // View the value of a string key
HGETALL <key_name>                      // View all fields/values of a Hash (object) key
TYPE <key_name>                         // Check data type (string, hash, list, etc.)
TTL <key_name>                          // Check seconds left until key expires (-1 = never)
INFO memory                             // See how much RAM Redis is currently using
EXIT                                    // Exit the shell