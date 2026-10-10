#!/usr/bin/env php
<?php
// Same bootstrap as the image's /app/bin/yii, plus the pilot seed controller.
use humhub\services\BootstrapService;

$loader = require('/opt/humhub/protected/vendor/autoload.php');
$humhubSrcPath = getenv('HUMHUB_ALIASES__HUMHUB') ?: '/opt/humhub/protected/humhub';
$loader->addClassMap([
    'humhub\\services\\BootstrapService' => $humhubSrcPath . '/services/BootstrapService.php',
    'pilot\\SeedController' => __DIR__ . '/SeedController.php',
]);

$bootstrap = new BootstrapService();
$bootstrap->setPaths(config: '/data/config');
$bootstrap->runConsole();
