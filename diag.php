<?php
$config = include 'db_config.php';
try {
    $dsn = "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset=utf8mb4";
    $pdo = new PDO($dsn, $config['username'], $config['password']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    echo "--- Recent Orders Analysis (Target: 308, 318) ---\n";
    $stmt = $pdo->query("SELECT id, orderNo, amount, status, createdAt, created_at, updated_at FROM orders ORDER BY id DESC LIMIT 10");
    $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);
    print_r($orders);

    echo "\n--- Recent Inventory Logs (Matching Screenshot) ---\n";
    // Assuming table is `inventory_logs` or similar based on screenshot context "action", "message"
    // If not sure, list tables first? No, user showed columns: id, orderId, action, pos, inventoryId, message, timestamp_ms
    // Let's guess the table name is `logs` or `inventory_action_logs`
    // Actually, looking at previous api.php might tell me the log table name. 
    // I'll stick to a safe query or list tables first if unsure. 
    // Wait, I see `api.php` uses `orders` and `inventory`. Logs might be in a separate file or table.
    // Let's check `api.php` source for logging logic first? No, I'll check tables.
    $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    print_r($tables);
    
    if (in_array('logs', $tables)) {
        $stmt = $pdo->query("SELECT * FROM logs ORDER BY id DESC LIMIT 20");
        print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
