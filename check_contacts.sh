#!/bin/bash
# Script to check if contacts exist in the database

echo "=== Checking Contacts in Database ==="
echo ""

# Check total count
echo "Total contacts in database:"
docker exec -it sg-lite-postgres psql -U sguser -d sg_lite -c "SELECT COUNT(*) as total_contacts FROM contacts;"

echo ""
echo "=== Sample contacts (first 10) ==="
docker exec -it sg-lite-postgres psql -U sguser -d sg_lite -c "SELECT id, email, first_name, last_name, status, owner_id FROM contacts LIMIT 10;"

echo ""
echo "=== Contacts by status ==="
docker exec -it sg-lite-postgres psql -U sguser -d sg_lite -c "SELECT status, COUNT(*) as count FROM contacts GROUP BY status;"

echo ""
echo "=== Contacts by owner ==="
docker exec -it sg-lite-postgres psql -U sguser -d sg_lite -c "SELECT owner_id, COUNT(*) as count FROM contacts GROUP BY owner_id;"

echo ""
echo "=== Recent contacts (last 5) ==="
docker exec -it sg-lite-postgres psql -U sguser -d sg_lite -c "SELECT id, email, status, created_at FROM contacts ORDER BY created_at DESC LIMIT 5;"

