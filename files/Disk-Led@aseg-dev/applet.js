/**
 * TODO: 
 * 
 * global.logWarning("Text: " + value); // ! for test
 */

const Applet = imports.ui.applet;
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gettext = imports.gettext;
const Main = imports.ui.main;
const AppletUUID = "Disk-Led@aseg-dev";

Gettext.bindtextdomain(AppletUUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str)
{
    let customTrans = Gettext.dgettext(AppletUUID, str);
    if (customTrans !== str && customTrans !== "")
        return customTrans;
    return Gettext.gettext(str);
}

class HddLed extends Applet.TextIconApplet
{
    constructor(orientation, panel_height, instance_id)
    {
        try
        {
            super(orientation, panel_height, instance_id);

            this.orientation = orientation;
            this.applet_directory = imports.ui.appletManager.appletMeta[AppletUUID].path; // applet root

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this.settings = new Settings.AppletSettings(this, AppletUUID, instance_id);

            this.settings.bind("custom-label", "custom_label", this.on_settings_changed);
            this.settings.bind("led-style", "led_style", this.on_settings_changed);
            try
            {
                this.settings.bind("hidden-disk-storage", "hidden_disk_storage"); // sdx state
                this.settings.bind("hidden-new-state", "hidden_new_state"); // new disc state
            }
            catch(ee)
            {
                global.logError(ee);
            }
            
            this.actor.style = "background-color: #00000000";

            this.on_settings_changed();

            this.prev_read_acces = new Array();
            this.prev_write_acces = new Array();

            this.isMenuOpen = false; // Track open state
            this.first_time = true;
            this.enabled_disks = new Array();

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
        
            this.menuManager.addMenu(this.menu);

            this.interval_menu = setInterval(() =>
            { // disk to monitor control panel loop
                this.makeMenu();
            }, 1000);

            this.interval_display = setInterval(() =>
            { // HDD led display loop
                this.R_W_state();
            }, 100);

        }
        catch(e)
        {
            global.logError(e);
        }
    }

//----------------------------------- end of constructor -----------------------------------//

    /**
     * @brief   extract disk names from /proc/mounts and return them
     * @brief   only mounted disks can be monitored
     * 
     * @param   none
     * @returns string array: disk labels
     */
    catchDisks()
    {
        let [success, data_array] = GLib.file_get_contents("/proc/mounts"); // read mounted filesystems

        data_array = data_array.toString().match(/sd.\d/gm); // search sdx[Index] (ex: sdc2)

        for(let i in data_array)
        {
            data_array[i] = data_array[i].slice(0, -1); // remove index
        }

        return [...new Set(data_array)]; // without duplicates
    }

    /**
     * @brief   Extracts the name and status of the disks from this.hidden_disk_storage
     * @brief   and adds them to the array passed as parameter
     * 
     * @param   temp_storage: string array
     * @returns string: extracted datas from temp_storage, sorted alphabetically
     */
    extract_disks(temp_storage)
    {
        if(this.hidden_disk_storage.match(/sd.\d/gm))
        { // there is at least one disk
            temp_storage = temp_storage.concat(this.hidden_disk_storage.match(/sd.\d/gm)).sort(); // like "sdx0" or "sdx1", sorted
        }
        else
        { // first time, first disk status is 1, regardless to this.hidden_new_state
            temp_storage.sort();
            temp_storage[0] = temp_storage[0].replace("0", "1");
        }
    
        return temp_storage.toString();
    }

    /**
     * @brief   manage disk names in this.hidden_disk_storage with checks
     * @brief   adds new mount disk, remove unmounted disk
     * 
     * @param   none
     * @returns boolean: true if there are changes
     */
    manageDiskInFile()
    {
        let
            is_changed = false,
            sdxItem = this.catchDisks(),
            temp_storage = new Array(); // HDD array

        for(let i in sdxItem)
        { // add loop
            if(!this.hidden_disk_storage.match(sdxItem[i] + "\\d"))
            {
                is_changed = true;
                temp_storage.push(sdxItem[i] + this.hidden_new_state); // add new disk with new disk status
            }
        }

        if(is_changed)
        { // new disk to add
            this.hidden_disk_storage = "," + this.extract_disks(temp_storage);
        }

        temp_storage = this.hidden_disk_storage.match(/sd./gm);

        for(let i in temp_storage)
        { // delete loop
            if(sdxItem.indexOf(temp_storage[i]) == -1)
            { // not found, delete it
                this.hidden_disk_storage = this.hidden_disk_storage.replace("," + this.hidden_disk_storage.match(temp_storage[i] + "\\d"),''); // delete it
                is_changed = true;
            }
        }

        return is_changed;
    }

    /**
     * @brief   search stored state of sdxItem
     * 
     * @param   sdxItem: string, the item to search
     * @return  number: state of sdxItem = 0 or 1 
     */
    storedDiskState(sdxItem)
    {
        const matches = this.hidden_disk_storage.match(sdxItem + "\\d"); // search stored state of sdxItem
        return Number(matches[0].slice(-1)); // 0 or 1
    }

    /**
     * @brief   addd switches to menu to enable/disable disk monitoring
     * 
     * @param   none
     * @return  none
     */
    addSwitchItem()
    {
        if(this.isMenuOpen)
        {
            return; // menu is open, not possible to change it
        }

        let
            switchItem,
            sdxItem = this.catchDisks(); // HDD array

        for(let i in sdxItem)
        {   // dynamic disk switch adding
            switchItem = new PopupMenu.PopupSwitchMenuItem(sdxItem[i], this.storedDiskState(sdxItem[i])); // Label and state
            switchItem.idInPane = sdxItem[i];
            switchItem.connect("toggled", (item, state) =>
            {
                if (state)
                { // on
                    this.hidden_disk_storage = this.hidden_disk_storage.replace(item.idInPane + "0", item.idInPane + "1");
                }
                else
                { // off
                    this.hidden_disk_storage = this.hidden_disk_storage.replace(item.idInPane + "1", item.idInPane + "0");
                }
            
            });

            this.menu.addMenuItem(switchItem);
        }
    }

    /**
     * @brief   add a new disk state switch to menu
     * @brief   0 to ignore disk, 1 to monitor disk
     *
     * @param   none
     * @return  none
     */
    add_switch_new_disk_state()
    {
        let switch_new_disk_state = new PopupMenu.PopupSwitchMenuItem(_("Status of new disks: ") + (this.hidden_new_state == 0 ? _("ignore") : _("monitor")), (this.hidden_new_state == 0 ? 0 : 1)); // enable or disable new disk monitoring

        switch_new_disk_state.connect("toggled", (item, state) =>
        {
            if (state)
            { // on
                this.hidden_new_state = 1;
            }
            else
            { // off
                this.hidden_new_state = 0;
            }

            item.label.text = _("Status of new disks: ") + (this.hidden_new_state == 0 ? _("ignore") : _("monitor"));
        });

        this.menu.addMenuItem(switch_new_disk_state);
    }

    /**
     * @brief   built disk to monitor control panel
     * 
     * @param   none
     * @return  none
     */
    makeMenu()
    {
        this.get_enabled_disks(); // disks to monitor
        
        if(!this.manageDiskInFile() && !this.first_time)
        { // no disk change, nothing to do
            return;
        };

        this.first_time = false;

        this.menu.removeAll(); // Clear current menu items

        let headMenu = new PopupMenu.PopupMenuItem(_("                    Disk to monitor"));
        headMenu.actor.set_style("font-weight: bold; font-size: 15px;");
        this.menu.addMenuItem(headMenu);

        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(separator);

        this.menu.connect('open-state-changed', Lang.bind(this, this._onMenuOpenStateChanged)); // Connect to the 'open-state-changed' signal

        this.set_applet_tooltip(_("Left-click: opens menu\nRight-click: opens settings"));

        this.add_switch_new_disk_state();

        let separator2 = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(separator2);

        this.addSwitchItem(); // Add disk monitor switches to menu

        Main.uiGroup.add_actor(this.menu.actor); // Add menu to applet
    }

    /**
     * @brief   Displays disk status with taskbar Led (every 0.1")
     * 
     * @param   disk: string
     * @return  array: r-w amount of disk
     */
    get_R_W_state(disk)
    {
        let [success, data_array] = GLib.file_get_contents("/sys/block/" + disk + "/stat"); // reading stat

        return data_array.toString().replace(/\s+/gm, " ").trim().split(" "); // data block split        
    }

    /**
     * @brief   get monitor enabled disks from this.hidden_disk_storage
     * 
     * @param   none
     * @return  none
     */
    get_enabled_disks()
    {
        let temp = this.hidden_disk_storage.match(/sd.1/gm); // all sdx1 disks
        if(temp == null)
        {
            temp = [];
        }

        for(let i in temp)
        {
            temp[i] = temp[i].slice(0, -1); // remove the final 1
        }

        this.enabled_disks = temp;
    }

    /**
     * @brief   Displays disk status with taskbar Led (every 0.1")
     * 
     * @param   none
     * @return  none
     */
    R_W_state()
    {
        let
            read_flag = "0",
            write_flag = "0";
        
        for(let i in this.enabled_disks)
        { // for all enabled disks
            let data_array = this.get_R_W_state(this.enabled_disks[i]);

            if(data_array[0] != this.prev_read_acces[i])
            { // Changed -> read
                read_flag = "1";
            }

            if(data_array[4] != this.prev_write_acces[i])
            { // Changed -> write
                write_flag = "1";
            }

            // Update counters
            this.prev_read_acces[i] = data_array[0];
            this.prev_write_acces[i] = data_array[4];
        }

        // Update icon
        this.set_applet_icon_path(this.applet_directory + "/icons/icon" + this.led_style + read_flag + write_flag + ".png");
    }

    _onMenuOpenStateChanged(menu, isOpen)
    {
        this.isMenuOpen = isOpen; // Update menu state
    }

    on_settings_changed()
    {
        this.set_applet_label(this.custom_label);
        this.set_applet_icon_path(this.applet_directory + "/icons/icon" + this.led_style + "00" + ".png");
    }

    on_applet_clicked(event)
    {
        this.menu.toggle();
    }

    on_applet_removed_from_panel()
    {
        if (this._intervalID)
        {
            clearInterval(this.interval_display); // Stop loop
        }

        if (this.interval_menu)
        {
            clearInterval(this.interval_menu); // Stop loop
        }

        this.settings.finalize(); // Remove all connections and file listeners

        global.log(" ---> " + AppletUUID + " has been removed <---");
    }
}

function main(metadata, orientation, panel_height, instance_id)
{
    return new HddLed(orientation, panel_height, instance_id);
}
