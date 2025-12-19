#!/bin/bash

source /app/log.sh
getLogger "database-setup"

# Function to replace placeholders in the SQL file and save to a new file
replace_placeholders() {
    local dest_file=$1
    local script_dir=$2
    send_log info "** Starting to set all configurations **"
    send_log debug "Destination file -> [ $dest_file ]"
    send_log debug "Script directory -> [ $script_dir ]"
    # Get all environment variables
    env | while IFS='=' read -r key value; do
        # Replace placeholders in the destination SQL file
        send_log system "Setting configuration for $key"
        send_log system "Value for $key is $value"
        send_log trace "sed -i 's/{$key}/$value/g' $script_dir/$dest_file"
        echo ""

        sed -i "s/{$key}/$value/g" "$script_dir/$dest_file"
    done
    send_log info "** All configurations was set **"
}

check_database_connection() {
    send_log info "** Starting to check database connection and query execution **"
    local count=0
    local max_attempts=100

    while [ $count -lt $max_attempts ]; do
        if PGPASSWORD=$DB_PASSWORD_ADMIN pg_isready -h "$DB_HOST" -p "$DB_PORT" -d postgres -U "$DB_USER_ADMIN" > /dev/null 2>&1; then
            send_log info "Database connection established"
            # Attempt to execute a simple query
            if PGPASSWORD=$DB_PASSWORD_ADMIN psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -U "$DB_USER_ADMIN" -c "SELECT 1" > /dev/null 2>&1; then
                send_log info "Successfully executed a test query"
                return 0
            else
                send_log warn "Connected to database, but failed to execute test query"
            fi
        fi

        send_log trace "Waiting for database connection and query execution... Attempt $((count+1)) of $max_attempts"
        sleep 5
        count=$((count+1))
    done

    send_log error "Failed to establish database connection or execute query after $max_attempts attempts"
    exit 1
}

setup_db(){
    send_log info "** Starting to setup database **"
    # Check database connection first
    check_database_connection
    
    # Run create_database.js
    send_log info "Running database creation script..."
    node /app/server/setup/create_database.js

    # Run migrations
    send_log info "Running database migrations..."
    cd /app && NODE_OPTIONS="--experimental-vm-modules" npx knex --knexfile $KNEXFILE migrate:latest

    send_log info "Running database seeds..."
    NODE_OPTIONS="--experimental-vm-modules" npx knex --knexfile $KNEXFILE seed:run || {
        local exit_code=$?
        send_log error "Seeds failed with exit code $exit_code"
        exit $exit_code
    }

    send_log info " ** Database setup completed **"
}

installed_client(){
    send_log info "** Starting to install client **"
    send_log debug "Installing client for postgres"
    # We already installed postgresql-client in Dockerfile
    send_log debug "Client for postgres installed"
}

installed_client
send_log info ">>>>> CLIENT INSTALLED <<<<<"

setup_db

send_log info "-----------------------------"
send_log info "----- PROCESS FINISHED  -----"
send_log info "-----------------------------"

while true; do
    sleep 1
done
