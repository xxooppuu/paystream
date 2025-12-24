<?php
header('Content-Type: text/plain; charset=utf-8');

echo "=== PayStream Server Diagnosis ===\n";
echo "Time: " . date('Y-m-d H:i:s') . "\n";
echo "PHP Version: " . phpversion() . "\n";
echo "Server Software: " . $_SERVER['SERVER_SOFTWARE'] . "\n\n";

echo "--- File System Check ---\n";
$files = [
    'index.html',
    'api.php',
    'simple_api.php',
    'db_config.php',
    'paystream.db'
];

foreach ($files as $file) {
    echo "File: $file\n";
    if (file_exists($file)) {
        echo "  - Exists: YES\n";
        echo "  - Size: " . filesize($file) . " bytes\n";
        echo "  - Permissions: " . substr(sprintf('%o', fileperms($file)), -4) . "\n";
        echo "  - Modified: " . date('Y-m-d H:i:s', filemtime($file)) . "\n";
        
        if ($file === 'index.html') {
            $content = file_get_contents($file);
            preg_match('/<title>(.*?)<\/title>/', $content, $matches);
            echo "  - Title Tag: " . ($matches[1] ?? 'NOT FOUND') . "\n";
            preg_match('/meta name="version" content="(.*?)"/', $content, $vMatches);
            echo "  - Version Meta: " . ($vMatches[1] ?? 'NOT FOUND') . "\n";
        }
    } else {
        echo "  - Exists: NO\n";
    }
    echo "\n";
}

echo "--- API Check ---\n";
// Try to include api.php and check version constant
if (file_exists('api.php')) {
    // Capture output to prevent HTML pollution
    ob_start();
    include 'api.php';
    ob_end_clean();
    echo "Files included successfully.\n";
    if (defined('APP_VERSION')) {
        echo "APP_VERSION Constant: " . APP_VERSION . "\n";
    } else {
        echo "APP_VERSION Constant: NOT DEFINED (Problem with api.php)\n";
    }
} else {
    echo "api.php missing, cannot test.\n";
}

echo "\n=== End Diagnosis ===\n";
