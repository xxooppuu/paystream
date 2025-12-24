<?php
header('Content-Type: text/plain');
echo "Asset Diagnosis Utility v1.0\n";
echo "============================\n\n";

$files = [
    'index.html',
    'assets/index-4rbYjlsv.js',
    'api.php'
];

foreach ($files as $file) {
    if (file_exists($file)) {
        echo "[FOUND] $file (" . filesize($file) . " bytes)\n";
    } else {
        echo "[MISSING] $file\n";
    }
}

echo "\nListing assets directory:\n";
if (is_dir('assets')) {
    $dir = scandir('assets');
    foreach ($dir as $f) {
        if ($f != '.' && $f != '..') {
            echo " - $f\n";
        }
    }
} else {
    echo "Directory 'assets' not found!\n";
}
?>
