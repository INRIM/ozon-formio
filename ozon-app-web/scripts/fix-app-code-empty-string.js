// Fix records where app_code is an empty string instead of an empty array.
//
// Usage (mongosh):
//   mongosh "mongodb://localhost:22222/ozonenv" --file scripts/fix-app-code-empty-string.js
//   mongosh "mongodb://localhost:22222/ozonenv" --eval "var dryRun=true" --file scripts/fix-app-code-empty-string.js
//
// With auth:
//   mongosh "mongodb://user:pass@localhost:22222/ozonenv?authSource=admin" --file scripts/fix-app-code-empty-string.js

const isDryRun = typeof dryRun !== 'undefined' ? dryRun : false;

if (isDryRun) print('[fix-app-code] DRY-RUN mode — no changes will be made\n');

const collections = await db.listCollections().toArray();
let totalFound = 0;
let totalFixed = 0;

for (const { name } of collections) {
    const coll = db.collection(name);
    const count = await coll.countDocuments({ app_code: '' });
    if (count === 0) continue;

    print(`[${name}] ${count} record with app_code: ""`);
    totalFound += count;

    if (!isDryRun) {
        const result = await coll.updateMany(
            { app_code: '' },
            { $set: { app_code: [] } }
        );
        print(`[${name}] fixed: ${result.modifiedCount}`);
        totalFixed += result.modifiedCount;
    }
}

if (totalFound === 0) {
    print('No records with app_code: "" found. Nothing to do.');
} else if (isDryRun) {
    print(`\nDRY-RUN: ${totalFound} record(s) need fixing. Re-run without --eval "var dryRun=true" to apply.`);
} else {
    print(`\nDone: ${totalFixed}/${totalFound} record(s) fixed.`);
}
