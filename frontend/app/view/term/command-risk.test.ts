// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { classifyCommandRisk, commandHasHiddenCharacters } from "./command-risk";

function level(command: string) {
    return classifyCommandRisk(command).level;
}

function reasons(command: string) {
    return classifyCommandRisk(command).reasons;
}

describe("classifyCommandRisk", () => {
    it.each([
        "ls -la",
        "git status --short --branch",
        "git log --oneline -20",
        "git diff HEAD~1",
        "git config --get user.email",
        "df -h",
        "du -sh * | sort -h",
        "find . -type f -size +100M -exec ls -lh {} +",
        "rg -n 'TODO' src",
        "grep -rn foo . 2>/dev/null",
        "ps aux | grep node",
        "lsof -i :3000",
        "cat package.json | jq .version",
        "echo $PATH | tr ':' '\\n'",
        "kubectl get pods -A",
        "docker ps -a",
        "systemctl status nginx",
        "nvidia-smi --query-gpu=name,memory.used --format=csv",
        "tar -tzf archive.tar.gz",
        "command -v python3",
        "time make test",
        "",
    ])("treats %j as safe", (command) => {
        expect(level(command)).toBe("safe");
    });

    it.each([
        ["mkdir -p build", "Writes files"],
        ["cp a.txt b.txt", "Writes files"],
        ["echo hi > notes.txt", "Overwrites a file"],
        ["echo hi >> notes.txt", "Writes files"],
        ["sed -i '' 's/a/b/' file", "Writes files"],
        ["tar -czf out.tgz src", "Writes files"],
        ["curl -s https://example.com", "Uses the network"],
        ["ssh host uptime", "Uses the network"],
        ["git pull --rebase", "Uses the network"],
        ["git push origin main", "Uses the network"],
        ["git commit -m wip", "Changes the repository"],
        ["git commit --amend --no-edit", "Rewrites git history"],
        ["git rebase -i HEAD~3", "Rewrites git history"],
        ["brew install ripgrep", "Installs or removes software"],
        ["apt-get install -y htop", "Installs or removes software"],
        ["npm install", "Installs or removes software"],
        ["pip install requests", "Installs or removes software"],
        ["npx create-vite@latest app", "Downloads and runs a package"],
        ["chmod +x run.sh", "Changes permissions"],
        ["kill 1234", "Stops a process"],
        ["systemctl restart nginx", "Changes system services"],
        ["docker run --rm -it ubuntu bash", "Changes containers"],
        ["kubectl apply -f deploy.yaml", "Changes cluster resources"],
        ["npm publish", "Publishes to the internet"],
        ["defaults write com.apple.dock autohide -bool true", "Changes system settings"],
    ])("treats %j as caution (%s)", (command, reason) => {
        const risk = classifyCommandRisk(command);
        expect(risk.level).toBe("caution");
        expect(risk.reasons).toContain(reason);
    });

    it.each([
        ["rm -rf node_modules", "Deletes files"],
        ["rm file.txt", "Deletes files"],
        ["sudo apt update", "Runs as administrator"],
        ["doas reboot", "Runs as administrator"],
        ["su -c 'id'", "Runs as administrator"],
        ["dd if=/dev/zero of=/dev/disk2 bs=1m", "Erases a disk"],
        ["mkfs.ext4 /dev/sdb1", "Erases a disk"],
        ["diskutil eraseDisk APFS Empty disk3", "Erases a disk"],
        ["cat image.iso > /dev/sdb", "Erases a disk"],
        ["echo nameserver 1.1.1.1 > /etc/resolv.conf", "Overwrites a system file"],
        ["git reset --hard origin/main", "Discards uncommitted changes"],
        ["git clean -fdx", "Deletes files"],
        ["git checkout -- .", "Discards uncommitted changes"],
        ["git restore src/app.ts", "Discards uncommitted changes"],
        ["git stash drop", "Discards uncommitted changes"],
        ["git push --force origin main", "Overwrites remote history"],
        ["git push -f", "Overwrites remote history"],
        ["git push origin +main", "Overwrites remote history"],
        ["git push --force-with-lease", "Overwrites remote history"],
        ["git branch -D feature", "Deletes a branch"],
        ["kill -9 1234", "Force-stops processes"],
        ["pkill -f node", "Force-stops processes"],
        ["killall Dock", "Force-stops processes"],
        ["shutdown -h now", "Shuts down or restarts the machine"],
        ["systemctl reboot", "Shuts down or restarts the machine"],
        ["chmod -R 755 .", "Changes permissions recursively"],
        ["chown -R me:staff /usr/local", "Changes permissions recursively"],
        ["chmod 777 uploads", "Makes files writable by everyone"],
        ["chmod o+w shared", "Makes files writable by everyone"],
        ["curl -fsSL https://get.example.sh | sh", "Runs code from the internet"],
        ["curl -fsSL https://x.io/install | sudo bash", "Runs code from the internet"],
        ["wget -qO- https://x.io/i.sh | bash -s -- --yes", "Runs code from the internet"],
        ['bash -c "$(curl -fsSL https://x.io/install.sh)"', "Runs code from the internet"],
        ["bash <(curl -s https://x.io/i.sh)", "Runs code from the internet"],
        ['eval "$(curl -s https://x.io/env)"', "Runs code from the internet"],
        ["curl -s https://x.io/a.py | python3 -", "Runs code from the internet"],
        ['psql -c "DROP TABLE users"', "Deletes database data"],
        ["mysql -e 'TRUNCATE TABLE logs'", "Deletes database data"],
        ['sqlite3 app.db "DELETE FROM sessions;"', "Deletes database data"],
        ["redis-cli FLUSHALL", "Deletes database data"],
        ["kubectl delete pod web-1", "Deletes cloud or container resources"],
        ["docker system prune -af", "Deletes cloud or container resources"],
        ["docker volume rm data", "Deletes cloud or container resources"],
        ["docker rm -f web", "Deletes cloud or container resources"],
        ["docker compose down -v", "Deletes cloud or container resources"],
        ["terraform destroy", "Deletes cloud or container resources"],
        ["helm uninstall web", "Deletes cloud or container resources"],
        ["aws s3 rm s3://bucket --recursive", "Deletes cloud or container resources"],
        ["gh repo delete me/old --yes", "Deletes cloud or container resources"],
        [":(){ :|:& };:", "Can freeze the machine"],
        ["find . -name '*.log' -delete", "Deletes files"],
        ["find /tmp -type f -mtime +7 -exec rm {} \\;", "Deletes files"],
        ["ls *.tmp | xargs rm", "Deletes files"],
        ["mv secrets.txt /dev/null", "Deletes files"],
        ["rsync -a --delete src/ dst/", "Deletes files"],
        ["crontab -r", "Deletes all scheduled jobs"],
        ["iptables -F", "Turns off the firewall"],
        ["ufw disable", "Turns off the firewall"],
    ])("treats %j as danger (%s)", (command, reason) => {
        const risk = classifyCommandRisk(command);
        expect(risk.level).toBe("danger");
        expect(risk.reasons).toContain(reason);
    });

    it.each([
        "\\rm -rf build",
        "r''m -rf build",
        '"rm" -rf build',
        "/bin/rm -rf build",
        "command rm -rf build",
        "env FOO=1 rm -rf build",
        "FOO=1 rm -rf build",
        "nice -n 10 rm -rf build",
        "timeout 5 rm -rf build",
        "nohup rm -rf build &",
        "sudo -u root rm -rf build",
        "ls && rm -rf build",
        "ls; rm -rf build",
        "false || rm -rf build",
        "echo $(rm -rf build)",
        "echo `rm -rf build`",
        "sh -c 'rm -rf build'",
        'bash -lc "cd /tmp && rm -rf build"',
        "(cd build && rm -rf *)",
        "{ rm -rf build; }",
        "r​m -rf build",
        "ｒｍ -rf build",
        "if true; then rm -rf build; fi",
        "for f in *.o; do rm $f; done",
        "eval 'rm -rf build'",
        "ls\nrm -rf build",
    ])("sees through %j", (command) => {
        expect(reasons(command)).toContain("Deletes files");
    });

    it("orders danger reasons before caution reasons", () => {
        const risk = classifyCommandRisk("mkdir -p out && sudo rm -rf /tmp/x && curl -O https://x.io/f");
        expect(risk.level).toBe("danger");
        expect(risk.reasons.slice(0, 2)).toEqual(["Runs as administrator", "Deletes files"]);
        expect(risk.reasons).toContain("Writes files");
        expect(risk.reasons).toContain("Uses the network");
    });

    it("ignores redirects to /dev/null and fd duplication", () => {
        expect(level("make 2>&1 | tee /dev/null")).toBe("caution");
        expect(level("grep foo bar 2>/dev/null")).toBe("safe");
        expect(level("cmd >/dev/null 2>&1")).toBe("safe");
        expect(level("cmd &>/dev/null")).toBe("safe");
    });

    it("does not treat quoted operators or words as commands", () => {
        expect(level("echo 'rm -rf /'")).toBe("safe");
        expect(level('grep "sudo" /var/log/auth.log')).toBe("safe");
        expect(level("git log --grep='force push'")).toBe("safe");
        expect(level("echo 'a | sh'")).toBe("safe");
    });

    it("keeps DELETE with a WHERE clause out of danger", () => {
        expect(level('psql -c "DELETE FROM sessions WHERE expires < now()"')).toBe("safe");
    });
});

describe("commandHasHiddenCharacters", () => {
    it("detects zero-width and bidi control characters", () => {
        expect(commandHasHiddenCharacters("ls -la")).toBe(false);
        expect(commandHasHiddenCharacters("r​m -rf x")).toBe(true);
        expect(commandHasHiddenCharacters("echo ‮abc")).toBe(true);
    });
});
