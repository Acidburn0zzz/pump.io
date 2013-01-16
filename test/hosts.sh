#!/bin/sh

grep "dialback.localhost" /etc/hosts || echo "127.0.69.1 dialback.localhost dialback" | sudo tee -a /etc/hosts
grep "social.localhost" /etc/hosts || echo "127.0.69.2 social.localhost social" | sudo tee -a /etc/hosts
grep "photo.localhost" /etc/hosts || echo "127.0.69.3 photo.localhost photo" | sudo tee -a /etc/hosts
grep "echo.localhost" /etc/hosts || echo "127.0.69.4 echo.localhost echo" | sudo tee -a /etc/hosts
grep "secure.localhost" /etc/hosts || echo "127.0.69.5 secure.localhost secure" | sudo tee -a /etc/hosts
grep "bounce.localhost" /etc/hosts || echo "127.0.69.6 bounce.localhost bounce" | sudo tee -a /etc/hosts
grep "firehose.localhost" /etc/hosts || echo "127.0.69.7 firehose.localhost firehose" | sudo tee -a /etc/hosts
grep "activityspam.localhost" /etc/hosts || echo "127.0.69.9 activityspam.localhost activityspam" | sudo tee -a /etc/hosts
