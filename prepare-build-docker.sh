#!/bin/bash

rm -rf packages/web/public/build
rm -rf packages/tools/lib
rm -rf packages/sqltree/lib
rm -rf packages/datalib/lib
rm -rf packages/filterparser/lib

node adjustPackageJson --community

yarn install

yarn setCurrentVersion

yarn printSecrets

yarn run prepare:docker


cd docker && docker build -t dbgate-moded-dbgate:latest .

cd ..
