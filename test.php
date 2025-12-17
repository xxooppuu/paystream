<?php
// Simple test to check PHP output
header('Content-Type: application/json');
echo json_encode([
    'status' => 'ok',
    'message' => 'Direct JSON test',
    'php_version' => phpversion(),
    'file_path' => __FILE__
]);
